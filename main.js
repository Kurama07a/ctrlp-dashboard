const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const WebSocket = require("ws");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const fsPromises = require("fs").promises;
const pdfToPrinter = require("pdf-to-printer");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);
const { PDFDocument } = require("pdf-lib");
// const electronReload = require("electron-reload"); // Added for hot reloading
const { autoUpdater } = require('electron-updater');
const SessionManager = require('./sessionManager'); // Added for session management

// Enable hot reloading

const FIXED_PAPER_SIZES = ["A4", "A3", "Letter", "Legal"];
const JOB_HISTORY_FILE = path.join(app.getPath("userData"), "jobHistory.json");
const METRICS_FILE = path.join(app.getPath("userData"), "metrics.json");
const DAILY_METRICS_FILE = path.join(app.getPath("userData"), "dailyMetrics.json");
const PRINTER_INFO_FILE = path.join(app.getPath("userData"), "printerInfo.json");
// Load environment variables from .env file if present
require('dotenv').config();

// Use environment variables with fallbacks for development
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY ;
const BUCKET_NAME = process.env.BUCKET_NAME ;
const WEBSOCKET_URL = process.env.WEBSOCKET_URL;
const TEMP_DIR = path.join(app.getPath("temp"), "CtrlP"); // Change download directory to temp in appdata
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}
let shopInfo = {};
let mainWindow;
let webSocket;
let supabase;
let jobHistory = new Map();
let printerInfo = { paperLevels: {}, discardedPrinters: [], capabilities: {} };
let metrics = {
  totalPages: 0,
  monochromeJobs: 0,
  colorJobs: 0,
  totalIncome: 0,
};
let dailyMetrics = {};
let printerQueues = new Map();
let isConnected = false;
let currentShopId = null;
let currentSecret = null;
let currentUser = null; // Added for session management
let sessionManager; // Added for session management

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
  if (mainWindow) mainWindow.webContents.send("log-message", message);
}

// Add a helper for KYC logging
function logKyc(message, data) {
  const msg = `[KYC] ${message}` + (data ? ` | ${JSON.stringify(data)}` : '');
  console.log(msg);
  try {
    if (mainWindow) mainWindow.webContents.send('log-message', msg);
  } catch (e) {}
}

async function getLastPageNumber(filePath) {
  const pdfBytes = await fsPromises.readFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  return pdfDoc.getPageCount();
}

function loadJobHistory() {
  try {
    if (fs.existsSync(JOB_HISTORY_FILE)) {
      const data = fs.readFileSync(JOB_HISTORY_FILE, "utf8");
      const jobs = JSON.parse(data);
      jobHistory = new Map(jobs.map((job) => [job.id, job]));
      log(`Loaded ${jobHistory.size} unique jobs from history`);
      //console.log(jobHistory);
    }
  } catch (error) {
    log(`Error loading job history: ${error.message}`);
    jobHistory = new Map();
  }
}

function saveJobHistory() {
  try {
    fs.writeFileSync(
      JOB_HISTORY_FILE,
      JSON.stringify([...jobHistory.values()], null, 2)
    );
    log(`Saved ${jobHistory.size} jobs to history`);
  } catch (error) {
    log(`Error saving job history: ${error.message}`);
  }
}

function loadPrinterInfo() {
  try {
    if (fs.existsSync(PRINTER_INFO_FILE)) {
      const data = fs.readFileSync(PRINTER_INFO_FILE, "utf8");
      printerInfo = JSON.parse(data);
      log("Loaded printer information from file");
      for (const printerName in printerInfo.capabilities) {
        if (
          !printerInfo.capabilities[printerName].paperSizes ||
          !(printerInfo.capabilities[printerName].paperSizes instanceof Set)
        ) {
          printerInfo.capabilities[printerName].paperSizes = new Set(
            Array.isArray(printerInfo.capabilities[printerName].paperSizes)
              ? printerInfo.capabilities[printerName].paperSizes
              : FIXED_PAPER_SIZES
          );
        }
      }
    }
  } catch (error) {
    log(`Error loading printer information: ${error.message}`);
    printerInfo = { paperLevels: {}, discardedPrinters: [], capabilities: {} };
  }
}

function savePrinterInfo() {
  try {
    fs.writeFileSync(PRINTER_INFO_FILE, JSON.stringify(printerInfo, null, 2));
    log("Saved printer information to file");
  } catch (error) {
    log(`Error saving printer info: ${error.message}`);
  }
}

function loadMetrics() {
  try {
    if (fs.existsSync(METRICS_FILE)) {
      const data = fs.readFileSync(METRICS_FILE, "utf8");
      metrics = JSON.parse(data);
      log("Loaded metrics from file");
      console.log(metrics);
    } else {
      saveMetrics();
    }
  } catch (error) {
    log(`Error loading metrics: ${error.message}`);
    metrics = {
      totalPages: 0,
      monochromeJobs: 0,
      colorJobs: 0,
      totalIncome: 0,
    };
  }
}

function saveMetrics() {
  try {
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2));
    log("Saved metrics to file");
  } catch (error) {
    log(`Error saving metrics: ${error.message}`);
  }
}

function loadDailyMetrics() {
  try {
    if (fs.existsSync(DAILY_METRICS_FILE)) {
      const data = fs.readFileSync(DAILY_METRICS_FILE, "utf8");
      dailyMetrics = JSON.parse(data);
      log("Loaded daily metrics from file");
    } else {
      saveDailyMetrics();
    }
  } catch (error) {
    log(`Error loading daily metrics: ${error.message}`);
    dailyMetrics = {};
  }
}

function saveDailyMetrics() {
  try {
    fs.writeFileSync(DAILY_METRICS_FILE, JSON.stringify(dailyMetrics, null, 2));
    log("Saved daily metrics to file");
  } catch (error) {
    log(`Error saving daily metrics: ${error.message}`);
  }
}

function updateDailyMetrics(job) {
  if (job.print_status === "completed") {
    const today = new Date().toISOString().split("T")[0];
    if (!dailyMetrics[today]) {
      dailyMetrics[today] = {
        totalPages: 0,
        monochromeJobs: 0,
        colorJobs: 0,
        totalIncome: 0,
      };
    }
    const pagesUsed = job.number_of_pages;
    dailyMetrics[today].totalPages += pagesUsed;
    if (job.color_mode.toLowerCase() === "color") {
      dailyMetrics[today].colorJobs++;
    } else {
      dailyMetrics[today].monochromeJobs++;
    }
    dailyMetrics[today].totalIncome += job.amount*0.8;
    saveDailyMetrics();
    mainWindow.webContents.send("daily-metrics-updated", dailyMetrics);
  }
}

function updateMetrics(job) {
  if (job.print_status === "completed") {
    const pagesUsed = job.number_of_pages;
    metrics.totalPages += pagesUsed;
    if (job.color_mode.toLowerCase() === "color") {
      metrics.colorJobs++;
    } else {
      metrics.monochromeJobs++;
    }
    metrics.totalIncome += job.amount*0.8;
    saveMetrics();
    updateDailyMetrics(job);
    mainWindow.webContents.send("metrics-updated", metrics);
  }
}

async function detectPrinterCapabilities(printerName) {
  const platform = process.platform;
  let capabilities = {
      color: true,
      duplex: false,
      paperSizes: new Set(FIXED_PAPER_SIZES),
      maxCopies: 999,
      supportedResolutions: ["300dpi"],
      // Job routing flags - defaults to allowing all job types
      colorJobsOnly: false,
      monochromeJobsOnly: false,
      duplexJobsOnly: false,
      simplexJobsOnly: false
  };

  try {
      if (platform === "win32") {
          const windowsCaps = await detectWindowsCapabilities(printerName);
          capabilities = { ...capabilities, ...windowsCaps };
      } else if (platform === "linux") {
          const linuxCaps = await detectLinuxCapabilities(printerName);
          capabilities = { ...capabilities, ...linuxCaps };
      } else if (platform === "darwin") {
          // Add macOS capability detection if needed
      }
  } catch (error) {
      log(`Error detecting capabilities for ${printerName}: ${error.message}`);
  }

  return capabilities;
}

async function detectWindowsCapabilities(printerName) {
  const command = `wmic printer where "Name='${printerName}'" list full`;
  const { stdout, stderr } = await execAsync(command);

  if (stderr) throw new Error(`WMIC error: ${stderr}`);

  const lines = stdout.split("\n").filter((line) => line.trim());
  let color = false;
  let duplex = false;
  const detectedPaperSizes = new Set();
  const resolutions = new Set();

  for (const line of lines) {
    if (line.startsWith("CapabilityDescriptions=")) {
      const capsMatch = line.match(/CapabilityDescriptions={(.+)}/);
      if (capsMatch) {
        const capabilitiesList = capsMatch[1]
          .split(",")
          .map((cap) => cap.trim().replace(/"/g, ""));
        color = capabilitiesList.some((cap) => cap.toLowerCase() === "color");
        duplex = capabilitiesList.some((cap) => cap.toLowerCase() === "duplex");
      }
    } else if (line.startsWith("PrinterPaperNames=")) {
      const paperMatch = line.match(/PrinterPaperNames={(.+)}/);
      if (paperMatch) {
        paperMatch[1].split(",").forEach((size) => {
          const trimmed = size.trim().replace(/"/g, "");
          if (FIXED_PAPER_SIZES.includes(trimmed))
            detectedPaperSizes.add(trimmed);
        });
      }
    } else if (
      line.startsWith("HorizontalResolution=") ||
      line.startsWith("VerticalResolution=")
    ) {
      const resMatch = line.match(/=(\d+)/);
      if (resMatch) resolutions.add(`${resMatch[1]}dpi`);
    }
  }

  return {
    color,
    duplex,
    paperSizes:
      detectedPaperSizes.size > 0
        ? detectedPaperSizes
        : new Set(FIXED_PAPER_SIZES),
    maxCopies: 999,
    supportedResolutions:
      resolutions.size > 0 ? Array.from(resolutions) : ["300dpi"],
  };
}

async function detectLinuxCapabilities(printerName) {
  const command = `lpoptions -p "${printerName}"`;
  const { stdout, stderr } = await execAsync(command);

  if (stderr) throw new Error(`lpoptions error: ${stderr}`);

  const options = stdout.split(" ").reduce((acc, opt) => {
    const [key, value] = opt.split("=");
    acc[key] = value;
    return acc;
  }, {});

  const color = options["ColorModel"]
    ? !options["ColorModel"].toLowerCase().includes("gray")
    : true;
  const duplex = options["Duplex"]
    ? !options["Duplex"].toLowerCase().includes("none")
    : false;
  const resolution = options["Resolution"] || "300dpi";

  const paperCommand = `lpstat -l -p "${printerName}"`;
  const { stdout: paperStdout } = await execAsync(paperCommand);
  const detectedPaperSizes = new Set();
  const paperMatch = paperStdout.match(/PaperSize Supported: (.+)/);
  if (paperMatch) {
    paperMatch[1].split(",").forEach((size) => {
      const trimmedSize = size.trim();
      if (FIXED_PAPER_SIZES.includes(trimmedSize))
        detectedPaperSizes.add(trimmedSize);
    });
  }

  return {
    color,
    duplex,
    paperSizes:
      detectedPaperSizes.size > 0
        ? detectedPaperSizes
        : new Set(FIXED_PAPER_SIZES),
    maxCopies: 999,
    supportedResolutions: [resolution],
  };
}

async function initializePrinters() {
  try {
    const allPrinters = await pdfToPrinter.getPrinters();
    const physicalPrinters = filterPhysicalPrinters(allPrinters);

    for (const printer of physicalPrinters) {
      if (!printerInfo.capabilities[printer.name]) {
        const capabilities = await detectPrinterCapabilities(printer.name);
        printerInfo.capabilities[printer.name] = capabilities;
        printerInfo.paperLevels[printer.name] = {};
        capabilities.paperSizes.forEach((size) => {
          printerInfo.paperLevels[printer.name][size] =
            printerInfo.paperLevels[printer.name][size] || 0;
        });
      }
      if (!printerQueues.has(printer.name)) {
        printerQueues.set(printer.name, []);
      }
    }

    for (const printerName of Object.keys(printerInfo.capabilities)) {
      if (!physicalPrinters.some((p) => p.name === printerName)) {
        delete printerInfo.capabilities[printerName];
        delete printerInfo.paperLevels[printerName];
        printerQueues.delete(printerName);
      }
    }

    savePrinterInfo();
    mainWindow.webContents.send("printer-info-updated", {
      printerInfo,
      printerQueues: Object.fromEntries(printerQueues),
    });
  } catch (error) {
    log(`Error initializing printers: ${error.message}`);
  }
}

function filterPhysicalPrinters(allPrinters) {
  const virtualPrinterKeywords = ["virtual", "fax"];
  return allPrinters.filter(
    (printer) =>
      !virtualPrinterKeywords.some((keyword) =>
        printer.name.toLowerCase().includes(keyword)
      )
  );
}

async function getPrinters() {
  await initializePrinters();
  return {
    printers: Object.entries(printerInfo.capabilities).map(([name, caps]) => ({
      name,
      capabilities: { ...caps, paperSizes: Array.from(caps.paperSizes) },
    })),
    printerInfo,
    printerQueues: Object.fromEntries(printerQueues),
  };
}

function updateDiscardedPrinters(_event, updatedDiscardedPrinters) {
  printerInfo.discardedPrinters = updatedDiscardedPrinters;
  savePrinterInfo();
  log(`Updated discarded printers: ${updatedDiscardedPrinters.join(", ")}`);
  mainWindow.webContents.send("printer-info-updated", {
    printerInfo,
    printerQueues: Object.fromEntries(printerQueues),
  });
  updateShopTechnicalInfo();
  if (areAllPrintersDiscarded(updatedDiscardedPrinters)) {
    closeWebSocket();
    mainWindow.webContents.send("all-printers-discarded");
  }
}

function areAllPrintersDiscarded(discardedPrinters) {
  const totalPrinters = Object.keys(printerInfo.paperLevels).length;
  return totalPrinters > 0 && totalPrinters === discardedPrinters.length;
}

function updatePrinterPaperLevels(_event, { printerName, levels }) {
  printerInfo.paperLevels[printerName] = levels;
  savePrinterInfo();
  log(`Updated paper levels for ${printerName}: ${JSON.stringify(levels)}`);
  mainWindow.webContents.send("printer-info-updated", {
    printerInfo,
    printerQueues: Object.fromEntries(printerQueues),
  });
}

function updatePaperLevels(printerName, paperSize, change) {
  if (
    printerInfo.paperLevels[printerName] &&
    printerInfo.paperLevels[printerName][paperSize] !== undefined
  ) {
    printerInfo.paperLevels[printerName][paperSize] = Math.max(
      0,
      printerInfo.paperLevels[printerName][paperSize] + change
    );
    savePrinterInfo();
    mainWindow.webContents.send("printer-info-updated", {
      printerInfo,
      printerQueues: Object.fromEntries(printerQueues),
    });
  }
}

function addOrUpdateJobInHistory(job, printerName, status) {
  const jobEntry = {
    ...job,
    assigned_printer: printerName,
    print_status: status,
    processed_timestamp: new Date().toISOString(),
    shop_id: currentShopId,
    pages_printed: job.number_of_pages+2,
    total_pages: job.number_of_pages,
  };

  jobHistory.set(job.id, jobEntry);
  saveJobHistory();
  mainWindow.webContents.send("job-history-updated");
  if (status === "completed") updateMetrics(jobEntry);
}

function parsePrintSettingsCode(code) {
  const settings = {
    orientation: "portrait",
    color_mode: "monochrome",
    duplex: "simplex",
    paper_size: "A4",
  };

  const paperTypeCode = Math.floor(code / 1000);
  settings.paper_size = ["A4", "A3", "Letter", "Legal"][paperTypeCode] || "A4";

  const remainingCode = code % 1000;
  if (remainingCode >= 100) {
    settings.duplex = "vertical";
    code -= 100;
  }
  if (remainingCode >= 10) {
    settings.color_mode = "color";
    code -= 10;
  }
  if (remainingCode % 10 === 1) settings.orientation = "landscape";

  return settings;
}

class JobScheduler {
  constructor() {
    this.processing = new Set();
    this.queueLocks = new Map();
  }

  async scheduleJob(job) {
    if (this.processing.has(job.id)) {
      log(`Job ${job.id} is already being processed`);
      return null;
    }

    const allPrinters = await pdfToPrinter.getPrinters();
    const validPrinters = this.filterValidPrinters(allPrinters, job);

    if (validPrinters.length === 0) {
      log(`No suitable printers for job ${job.id}`);
      return null;
    }

    const bestPrinter = this.findBestPrinter(validPrinters, job);
    if (!bestPrinter) {
      log(`No best printer found for job ${job.id}`);
      return null;
    }

    if (!printerQueues.has(bestPrinter.name)) {
      printerQueues.set(bestPrinter.name, []);
    }

    printerQueues.get(bestPrinter.name).push({ ...job, print_status: "received" });
    this.processing.add(job.id);
    mainWindow.webContents.send("printer-queues-updated", Object.fromEntries(printerQueues));

    setTimeout(() => this.processQueue(bestPrinter.name), 0);
    return bestPrinter;
  }

// Replace the existing filterValidPrinters method in JobScheduler class

filterValidPrinters(printers, job) {
  return printers.filter((printer) => {
    const caps = printerInfo.capabilities[printer.name];
    const paperLevels = printerInfo.paperLevels[printer.name];
    const pagesNeeded = (job.number_of_pages + 2);

    // Basic capability checks
    if (!caps || 
        !paperLevels || 
        printerInfo.discardedPrinters.includes(printer.name) ||
        !caps.paperSizes.has(job.paper_size) || 
        paperLevels[job.paper_size] < pagesNeeded) {
      return false;
    }
    
    // Color capability checks
    if (job.color_mode.toLowerCase() === "color" && !caps.color) {
      return false;
    }
    
    // Duplex capability checks
    if (job.duplex !== "simplex" && !caps.duplex) {
      return false;
    }
    
    // Job routing rule checks
    if (caps.colorJobsOnly && job.color_mode.toLowerCase() !== "color") {
      return false;
    }
    
    if (caps.monochromeJobsOnly && job.color_mode.toLowerCase() === "color") {
      return false;
    }
    
    if (caps.duplexJobsOnly && job.duplex === "simplex") {
      return false;
    }
    
    if (caps.simplexJobsOnly && job.duplex !== "simplex") {
      return false;
    }
    
    return true;
  });
}

// Replace the existing findBestPrinter method in JobScheduler class

findBestPrinter(printers, job) {
  const scoredPrinters = printers.map((printer) => {
    const caps = printerInfo.capabilities[printer.name];
    const paperLevel = printerInfo.paperLevels[printer.name][job.paper_size] || 0;
    const queueLength = printerQueues.get(printer.name)?.length || 0;

    // Skip this printer if it doesn't match our job routing rules
    if (caps.colorJobsOnly && job.color_mode.toLowerCase() !== "color") {
      return { printer, score: -1000 }; // Very negative score to ensure it's not selected
    }
    
    if (caps.monochromeJobsOnly && job.color_mode.toLowerCase() === "color") {
      return { printer, score: -1000 };
    }
    
    if (caps.duplexJobsOnly && job.duplex === "simplex") {
      return { printer, score: -1000 };
    }
    
    if (caps.simplexJobsOnly && job.duplex !== "simplex") {
      return { printer, score: -1000 };
    }

    let score = paperLevel / 1000 - queueLength * 0.5;
    if (caps.color && job.color_mode.toLowerCase() === "color") score += 0.2;
    if (caps.duplex && job.duplex !== "simplex") score += 0.2;

    return { printer, score };
  });

  scoredPrinters.sort((a, b) => b.score - a.score);
  
  // Filter out printers with negative scores (those that don't match routing rules)
  const validPrinters = scoredPrinters.filter(p => p.score >= 0);
  
  return validPrinters.length > 0 ? validPrinters[0].printer : null;
}

  async processQueue(printerName) {
    if (this.queueLocks.get(printerName)) {
      log(`Queue for printer ${printerName} is already being processed`);
      return false;
    }

    const queue = printerQueues.get(printerName);
    if (!queue || queue.length === 0) {
      log(`No jobs in queue for printer ${printerName}`);
      return false;
    }

    this.queueLocks.set(printerName, true);
    log(`Locked queue for printer ${printerName}`);

    let processedAny = false;

    try {
      while (queue.length > 0) {
        const job = queue[0];
        await this.processJob(printerName, job);
        processedAny = true;
      }
    } finally {
      this.queueLocks.set(printerName, false);
      log(`Released queue lock for printer ${printerName}`);
    }

    return processedAny;
  }

  async processJob(printerName, job) {
    job.print_status = "in-progress";
    log(`Processing job ${job.id} on printer ${printerName}`);

    const printingUpdate = {
      type: "job_status",
      data: {
        jobId: job.id,
        userId: job.user_id,
        status: "printing",
        reason: "Processing started",
      },
    };

    sendMessage(printingUpdate.type, printingUpdate.data);
    mainWindow.webContents.send("printer-queues-updated", Object.fromEntries(printerQueues));

    try {
      const filePath = await downloadFileFromSupabase(job.combined_file_path);
      const printOptions = createPrintOptions(job, { name: printerName });

      log(`Printing job ${job.id} with options: ${JSON.stringify(printOptions)}`);
      await printJobWithWrappers(filePath, printOptions, job);

      updatePaperLevels(printerName, job.paper_size, (-(job.number_of_pages)-2));

      const queue = printerQueues.get(printerName);
      queue.shift();

      this.processing.delete(job.id);
      job.print_status = "completed";
      addOrUpdateJobInHistory(job, printerName, "completed");

      const completedUpdate = {
        type: "job_status",
        data: {
          jobId: job.id,
          userId: job.user_id,
          status: "completed",
          reason: "Print job finished",
        },
      };

      sendMessage(completedUpdate.type, completedUpdate.data);
      mainWindow.webContents.send("print-complete", job.id);
      mainWindow.webContents.send("printer-queues-updated", Object.fromEntries(printerQueues));
    } catch (error) {
      log(`Error processing job ${job.id}: ${error.message}`);
      job.print_status = "failed";

      const queue = printerQueues.get(printerName);
      queue.shift();

      this.processing.delete(job.id);
      addOrUpdateJobInHistory(job, printerName, "failed");

      const failedUpdate = {
        type: "job_status",
        data: {
          jobId: job.id,
          userId: job.user_id,
          status: "failed",
          reason: error.message,
        },
      };

      sendMessage(failedUpdate.type, failedUpdate.data);
      mainWindow.webContents.send("print-failed", job.id);
      mainWindow.webContents.send("printer-queues-updated", Object.fromEntries(printerQueues));
    }
  }
}

const scheduler = new JobScheduler();

async function processPrintJob(event, job) {
  try {
    if (
      jobHistory.has(job.id) &&
      ["completed", "in-progress"].includes(jobHistory.get(job.id).print_status)
    ) {
      log(`Job ${job.id} already processed or in progress`);
      return;
    }

    addOrUpdateJobInHistory(job, null, "received");
    const parsedJob = {
      ...job,
      ...parsePrintSettingsCode(job.printsettings_code || 0),
      number_of_pages: job.number_of_pages || 1,
      copies: job.copies || 1,
    };

    const printer = await scheduler.scheduleJob(parsedJob);
    if (!printer) {
      addOrUpdateJobInHistory(parsedJob, null, "failed");
      mainWindow.webContents.send("print-failed", parsedJob.id);

      const failedUpdate = {
        type: "job_status",
        data: {
          jobId: parsedJob.id,
          userId: parsedJob.user_id,
          status: "failed",
          reason: "No suitable printer available",
        },
      };

      sendMessage(failedUpdate.type, failedUpdate.data);
    }
  } catch (error) {
    log(`Error processing job ${job.id}: ${error.message}`);
    addOrUpdateJobInHistory(job, null, "failed");
    mainWindow.webContents.send("print-failed", job.id);

    const failedUpdate = {
      type: "job_status",
      data: {
        jobId: job.id,
        userId: job.user_id,
        status: "failed",
        reason: error.message,
      },
    };

    sendMessage(failedUpdate.type, failedUpdate.data);
  }
}

async function printJobWithWrappers(filePath, printOptions, job) {
  try {
    // Load the PDF to determine the total number of pages
    const pdfBytes = await fsPromises.readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();

    if (totalPages < 3) {
      throw new Error("The document must have at least 3 pages (cover, content, and end page).");
    }

    // Check if we need special handling for landscape or duplex
    const needsSpecialHandling = 
      printOptions.orientation === "landscape" || 
      (job.duplex && job.duplex !== "simplex") || printOptions.copies > 1;

    if (needsSpecialHandling) {
      // Print the first page (cover invoice) with default settings
      const firstPageOptions = {
        printer: printOptions.printer,
        pages: "1",
        copies: 1,
        monochrome: true, // Default to monochrome for the cover
      };
      await pdfToPrinter.print(filePath, firstPageOptions);
      log(`Printed the first page (cover) for job ${job.id}`);

      // Print the main content with the provided print options
      const mainContentOptions = {
        ...printOptions,
        pages: `2-${totalPages - 1}`, // Exclude the first and last pages
      };
      await pdfToPrinter.print(filePath, mainContentOptions);
      log(`Printed the main content for job ${job.id}`);

      // Print the last page (end invoice) with default settings
      const lastPageOptions = {
        printer: printOptions.printer,
        pages: `${totalPages}`,
        copies: 1,
        monochrome: true, // Default to monochrome for the end page
      };
      await pdfToPrinter.print(filePath, lastPageOptions);
      log(`Printed the last page (end invoice) for job ${job.id}`);
    } else {
      // For normal portrait/simplex jobs, print everything at once
      await pdfToPrinter.print(filePath, printOptions);
      log(`Printed all pages at once for job ${job.id} with standard settings`);
    }

    // Delete the PDF after successful printing
    fs.unlinkSync(filePath);
    log(`Deleted file after printing: ${filePath}`);
  } catch (error) {
    log(`Error printing job ${job.id}: ${error.message}`);
    throw error;
  }
}

async function downloadFileFromSupabase(fileName) {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .download(fileName);

  if (error) throw error;
  if (!data) throw new Error("No data received from Supabase");

  const filePath = path.join(TEMP_DIR, fileName); // Save to temp directory
  await fsPromises.writeFile(filePath, Buffer.from(await data.arrayBuffer()));
  log(`File downloaded to temp directory: ${fileName}`);
  return filePath;
}

function createPrintOptions(job, printer) {
  const caps = printerInfo.capabilities[printer.name];
  return {
    printer: printer.name,
    pages: `${job.start_page || 1}-${job.end_page || job.number_of_pages+2}`,
    copies: Math.min(job.copies, caps.maxCopies),
    // side: caps.duplex ? getDuplexMode(job.duplex) : "simplex"
    monochrome: job.color_mode.toLowerCase() === "monochrome" || !caps.color,
    paperSize: caps.paperSizes.has(job.paper_size) ? job.paper_size : "A4",
    orientation: job.orientation.toLowerCase(),
    resolution: caps.supportedResolutions[0],
  };
}

function getDuplexMode(duplex) {
  switch (duplex) {
    case "horizontal":
      return "short-edge";
    case "vertical":
      return "duplex";
    default:
      return "simplex";
  }
}

function toggleWebSocket(_event, connect) {
  if (connect) initializeWebSocket();
  else closeWebSocket();
  isConnected = connect;
}

function initializeWebSocket() {
  if (areAllPrintersDiscarded(printerInfo.discardedPrinters)) {
    log("Cannot initialize WebSocket: All printers are discarded");
    mainWindow.webContents.send("websocket-status", "disabled");
    return;
  }

  if (!currentShopId || !currentSecret) {
    log("Cannot initialize WebSocket: No shop ID or secret available");
    mainWindow.webContents.send("websocket-status", "disabled");
    return;
  }

  if (!webSocket || webSocket.readyState !== WebSocket.OPEN) {
    const authToken = `${currentShopId}:${currentSecret}`;
    webSocket = new WebSocket(WEBSOCKET_URL, [], {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    webSocket.on("open", () => {
      log(`WebSocket connected for shop ${currentShopId}`);
      mainWindow.webContents.send("websocket-status", "connected");
      isConnected = true;
      sendMessage("SHOP_OPEN", { shopid: [currentShopId] });
    });

    webSocket.on("message", async (data) => {
      const message = JSON.parse(data.toString());
      log(`Received WebSocket message: ${JSON.stringify(message)}`);

      switch (message.type) {
        case "job_request":
          if (message.data) {
            const job = message.data;
            mainWindow.webContents.send("print-job", job);
            processPrintJob(null, job);
            sendMessage("JOB_RECEIVED", { shopId: currentShopId , jobId: job.id, status: "received" });
          }
          break;
        case "PING":
          sendMessage("PONG", { timestamp: Date.now() });
          break;
        case "ERROR":
          log(`WebSocket error: ${message.data.message}`);
          mainWindow.webContents.send("websocket-status", "error");
          break;
        case "CONNECTED":
          log(`Server confirmed connection: ${message.data.message}`);
          break;
      }
    });

    webSocket.on("error", (error) => {
      log(`WebSocket error: ${error.message}`);
      mainWindow.webContents.send("websocket-status", "error");
      mainWindow.webContents.send("force-toggle-websocket", false);
      isConnected = false;
    });

    webSocket.on("close", () => {
      log("WebSocket connection closed");
      mainWindow.webContents.send("websocket-status", "disconnected");
      mainWindow.webContents.send("force-toggle-websocket", false);
      isConnected = false;
    });
  }
}

function closeWebSocket() {
  if (webSocket && webSocket.readyState === WebSocket.OPEN) {
    sendMessage("SHOP_CLOSED", { shopid: [currentShopId] });
    webSocket.close();
  }
  webSocket = null;
  isConnected = false;
  mainWindow.webContents.send("websocket-status", "disconnected");
}

function sendMessage(type, data) {
  if (webSocket && webSocket.readyState === WebSocket.OPEN) {
    const message = JSON.stringify({ type, data });
    webSocket.send(message);
    log(`Sent ${type} message: ${JSON.stringify(data)}`);
  }
}

// Modify handleLogin to save user session
async function handleLogin(event, { email, password }) {
  try {
    const { data: account, error: accountError } = await supabase
      .from("shop_accounts")
      .select("id, shop_name, email, secret, shop_id")
      .eq("email", email)
      .eq("secret", password)
      .single();

    if (accountError) throw accountError;

    let kyc_verified = false;
    if (account.shop_id) {
      const { data: shop, error: shopError } = await supabase
        .from("print_shops")
        .select("id")
        .eq("id", account.shop_id)
        .single();

      if (!shopError && shop) {
        kyc_verified = true;
      }
    }

    currentShopId = account.shop_id || null;
    currentSecret = account.secret;

    const user = {
      id: account.id,
      shop_name: account.shop_name,
      email: account.email,
      shop_id: account.shop_id || null,
      kyc_verified,
      secret: account.secret // Store the secret for session restoration
    };

    // Save the user session
    sessionManager.saveSession(user);
    currentUser = user;

    event.reply("auth-success", user);
    log(`User logged in: ${user.email}, KYC verified: ${kyc_verified}`);

    if (kyc_verified) {
      mainWindow.webContents.send("kyc-verified");
    } else {
      mainWindow.webContents.send("kyc-required");
    }

    await fetchShopInfo(user.email);
  } catch (error) {
    log(`Login error: ${error.message}`);
    event.reply("auth-error", error.message || "Invalid credentials");
  }
}

// Also update the test login to save session
async function handleTestLogin(event) {
  try {
    const user = {
      id: "test-user-id",
      shop_name: "Test Shop",
      email: "test@ctrlp.com",
      shop_id: "test-shop-id",
      kyc_verified: true,
      isTestUser: true,
      secret: "test-secret"
    };

    // Save the test user session
    sessionManager.saveSession(user);
    currentUser = user;

    currentShopId = user.shop_id;
    currentSecret = user.secret;

    event.reply("auth-success", user);
    log(`Test user logged in: ${user.email}`);

    mainWindow.webContents.send("kyc-verified");
    await fetchShopInfo(user.email);
  } catch (error) {
    log(`Test login error: ${error.message}`);
    event.reply("auth-error", error.message || "Test login failed");
  }
}

// Update handleSignOut to clear the session
function handleSignOut(event) {
  currentShopId = null;
  currentSecret = null;
  currentUser = null;
  
  // Clear the saved session
  sessionManager.clearSession();
  
  closeWebSocket();
  event.reply("sign-out-success");
  log("User signed out");
}

async function handleSignup(event, { email, password }) {
  try {
    const { data, error } = await supabase
      .from("shop_accounts")
      .insert({ email, secret: password })
      .select()
      .single();

    if (error) throw error;

    const user = {
      id: data.id,
      shop_name: data.shop_name || "New Shop",
      email: data.email,
      shop_id: data.shop_id || null,
      kyc_verified: false,
    };

    event.reply("auth-success", user);
    log(`User signed up: ${user.email}`);
  } catch (error) {
    log(`Signup error: ${error.message}`);
    event.reply("auth-error", error.message);
  }
}

async function handleSaveKycData(event, formData) {
  try {
    const kycData = {
      shop_name: formData.shop_name,
      owner_name: formData.owner_name,
      contact_number: formData.contact_number,
      email: formData.email,
      address: formData.address,
      city: formData.city,
      state: formData.state,
      pincode: formData.pincode,
      gst_number: formData.gst_number,
      aadhaar: formData.aadhaar,
      pan_card_path: formData.pan_card_path,
      bank_proof_path: formData.bank_proof_path,
      passport_photo_path: formData.passport_photo_path,
      account_holder_name: formData.account_holder_name,
      account_number: formData.account_number,
      ifsc_code: formData.ifsc_code,
      bank_name: formData.bank_name,
      branch_name: formData.branch_name,
      kyc_status: "pending",
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("shop_accounts").upsert(kycData);

    if (error) throw error;
    event.reply("kyc-data-saved", { success: true });
    log("KYC data saved successfully");
  } catch (error) {
    event.reply("kyc-data-saved", { success: false, error: error.message });
    log(`Error saving KYC data: ${error.message}`);
  }
}

async function updateShopTechnicalInfo() {
  if (!currentShopId) return;

  try {
    const supportedSettings = {};
    const paperLevels = {};

    for (const [printerName, capabilities] of Object.entries(printerInfo.capabilities)) {
      if (printerInfo.discardedPrinters.includes(printerName)) {
        continue; // Skip discarded printers
      }

      const paperSizes = Array.from(capabilities.paperSizes || FIXED_PAPER_SIZES);
      const supportedPrintSettings = [];

      // Generate printsettings_code for each combination of capabilities
      for (const paperType of paperSizes) {
        for (const orientation of ['portrait', 'landscape']) {
          for (const color of printerInfo.capabilities[printerName].color ? [true, false] : [false]) {
            for (const doubleSided of printerInfo.capabilities[printerName].duplex ? [true, false] : [false]) {
              const settings = {
                orientation,
                color,
                doubleSided,
                paperType,
              };
              const code = generatePrintSettingsCode(settings);
              supportedPrintSettings.push(code);
            }
          }
        }
      }

      supportedSettings[printerName] = {
        supportedPrintSettings,
        paperLevels: printerInfo.paperLevels[printerName] || {},
      };
    }

    console.log("Supported settings:", supportedSettings);

    // Update the shop's technical info in the database
    const { error } = await supabase
      .from("print_shops")
      .update({
        supported_settings: supportedSettings,
      })
      .eq("id", currentShopId);

    if (error) throw error;

    log("Shop technical information updated successfully");

    // Send supportedSettings to WebSocket
   
      sendMessage("SUPPORTED_SETTINGS_UPDATED", { supportedSettings });
      log("Supported settings sent to WebSocket");

  } catch (error) {
    log(`Error updating shop technical information: ${error.message}`);
  }
}

// Helper function to generate printsettings_code
function generatePrintSettingsCode(settings) {
  let code = 0;

  // Orientation: portrait=0, landscape=1
  if (settings.orientation === 'landscape') {
    code += 1;
  }

  // Color: BW=0, Color=10
  if (settings.color) {
    code += 10;
  }

  // Double-sided: simplex=0, duplex=100
  if (settings.doubleSided) {
    code += 100;
  }

  // Paper type: multiply by 1000
  const PaperType = {
    A4: 0,
    A3: 1,
    LETTER: 2,
    LEGAL: 3,
  };

  const paperTypeCode = PaperType[settings.paperType.toUpperCase()] || PaperType.A4;
  code += paperTypeCode * 1000;

  return code;
}

async function fetchShopInfo(userEmail) {
  try {
    const { data, error } = await supabase
      .from("shop_accounts")
      .select(
        "shop_name, owner_name, contact_number, email, address, city, state, pincode, gst_number, kyc_status, updated_at"
      )
      .eq("email", userEmail)
      .single();

    if (error) throw error;

     shopInfo = {
      shop_name: data.shop_name || "Not Provided",
      owner_name: data.owner_name || "Not Provided",
      contact_number: data.contact_number || "Not Provided",
      email: data.email || "Not Provided",
      address: data.address || "Not Provided",
      city: data.city || "Not Provided",
      state: data.state || "Not Provided",
      pincode: data.pincode || "Not Provided",
      gst_number: data.gst_number || "Not Provided",
      kyc_status: data.kyc_status || "waiting for document upload",
      updated_at: data.updated_at || new Date().toISOString(),
    };

    mainWindow.webContents.send("shop-info-fetched", shopInfo);
    log("Shop information fetched successfully");
  } catch (error) {
    log(`Error fetching shop information: ${error.message}`);
    mainWindow.webContents.send("shop-info-fetched", { error: error.message });
  }
}

async function updateShopInfo(updatedInfo) {
  if (!currentShopId) return;

  try {
    const { error } = await supabase
      .from("print_shops")
      .update(updatedInfo)
      .eq("id", currentShopId);

    if (error) throw error;

    mainWindow.webContents.send("shop-info-updated", { success: true });
    log("Shop information updated successfully");
  } catch (error) {
    mainWindow.webContents.send("shop-info-updated", {
      success: false,
      error: error.message,
    });
    log(`Error updating shop information: ${error.message}`);
  }
}

// main.js
async function uploadDocumentToBucket(bucketName, filePath, fileName) {
  logKyc(`Uploading document to bucket`, { bucketName, filePath, fileName });
  try {
      console.log(`Uploading to bucket: ${bucketName}, filePath: ${filePath}, fileName: ${fileName}`);
      if (!filePath || !fs.existsSync(filePath)) {
          throw new Error(`Invalid file path: ${filePath}`);
      }

      const fileContent = fs.readFileSync(filePath); // Read as binary

      let contentType;
      if (filePath.endsWith('.pdf')) {
          contentType = 'application/pdf';
      } else if (filePath.endsWith('.png')) {
          contentType = 'image/png';
      } else if (filePath.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
          contentType = 'image/jpeg';
      } else {
          contentType = 'application/octet-stream'; // Default for unknown types
      }

      const { data, error } = await supabase.storage
          .from(bucketName)
          .upload(fileName, fileContent, {
              contentType: contentType
          });

      if (error) {
          logKyc(`Supabase upload error: ${error.message}`);
          throw error;
      }

      logKyc(`Uploaded ${fileName} to ${bucketName}: ${data.path}`);
      return data.path;
  } catch (error) {
      logKyc(`Error uploading to ${bucketName}: ${error.message}`);
      throw error;
  }
}
ipcMain.handle('submit-kyc-data', async (_event, kycData) => {
  logKyc('Received submit-kyc-data IPC call', kycData);
  try {
      console.log('Received KYC data:', kycData);

      // Validate required fields
      const requiredFields = [ 'address', 'aadhaar', 'pan_card_path', 'bank_proof_path', 'passport_photo_path'];
      for (const field of requiredFields) {
          if (!kycData[field]) {
              logKyc(`Missing required field: ${field}`);
              throw new Error(`Missing required field: ${field}`);
          }
      }

      // Validate file paths
      const fileFields = ['aadhaar', 'pan_card_path', 'bank_proof_path', 'passport_photo_path'];
      for (const field of fileFields) {
          if (!fs.existsSync(kycData[field])) {
              logKyc(`File not found: ${kycData[field]}`);
              throw new Error(`File not found: ${kycData[field]}`);
          }
      }

      // Fetch shop account
      const { data: shopAccount, error: accountError } = await supabase
          .from('shop_accounts')
          .select('id')
          .eq('email', shopInfo.email)
          .single();

      if (accountError || !shopAccount) {
          logKyc('Shop account error', accountError?.message || 'No account found');
          throw new Error('Shop account not found');
      }

      const shopId = shopAccount.id;
      const identifier = `${shopId}-${Date.now()}`;

      // Define bucket mapping
      const docTypes = {
          aadhaar: 'aadhar',
          pan_card_path: 'pan',
          bank_proof_path: 'bank-proof',
          passport_photo_path: 'passport-photos',
      };

      const uploadedPaths = {};
      for (const [field, bucket] of Object.entries(docTypes)) {
          const filePath = kycData[field];
          const docType = field === 'aadhar' ? 'aadhaar-front' : field.replace('_path', '');
          const fileName = `${identifier}-${docType}`;
          logKyc(`Uploading document: ${field} to bucket: ${bucket}`);
          uploadedPaths[field] = await uploadDocumentToBucket(bucket, filePath, fileName);
          logKyc(`Uploaded ${field} to ${bucket}: ${uploadedPaths[field]}`);
      }

      // Prepare KYC payload
      const kycPayload = {
          address: kycData.address,
          state: kycData.state,
          aadhaar: uploadedPaths.aadhaar,
          pan_card_path: uploadedPaths.pan_card_path,
          bank_proof_path: uploadedPaths.bank_proof_path,
          passport_photo_path: uploadedPaths.passport_photo_path,
          account_holder_name: kycData.account_holder_name,
          account_number: kycData.account_number,
          ifsc_code: kycData.ifsc_code,
          bank_name: kycData.bank_name,
          branch_name: kycData.branch_name,
          kyc_status: 'under_reveiw',
          updated_at: new Date().toISOString(),
      };

      logKyc('Updating shop_accounts with KYC payload', kycPayload);

      // Update shop account
      const { error: updateError } = await supabase
          .from('shop_accounts')
          .update(kycPayload)
          .eq('id', shopId);

      if (updateError) {
          logKyc('Error updating KYC data', updateError.message);
          throw updateError;
      }

      logKyc('KYC data submitted successfully');
      return { success: true };
  } catch (error) {
      logKyc('Error submitting KYC data', error.message);
      return { success: false, error: error.message };
  }
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    frame: true,
    title: "CTRL-P Dashboard",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: false,
    },
  });

  mainWindow.loadFile("index.html");
}

// Update the checkForSavedSession function
async function checkForSavedSession() {
  try {
    const savedUser = sessionManager.loadSession();
    if (savedUser) {
      log('Found saved user session, attempting to restore...');
      currentUser = savedUser;
      currentShopId = savedUser.shop_id || null;
      currentSecret = savedUser.secret;
      
      // Restore user session in the renderer
      mainWindow.webContents.on('did-finish-load', () => {
        log('Restoring user session in renderer');
        mainWindow.webContents.send('auth-success', savedUser);
        
        if (savedUser.kyc_verified) {
          mainWindow.webContents.send('kyc-verified');
        } else {
          mainWindow.webContents.send('kyc-required');
        }
        
        fetchShopInfo(savedUser.email);
      });
    } else {
      // No session found, notify renderer
      mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('session-check-complete');
      });
    }
  } catch (error) {
    log(`Error restoring user session: ${error.message}`);
    sessionManager.clearSession();
    
    // Error occurred, notify renderer
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('session-check-complete');
    });
  }
}

app.whenReady().then(async () => {
  // Initialize session manager
  sessionManager = new SessionManager(app);
  
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    fetch: (url, options) => {
      options.duplex = "half"; // Add duplex option to support body in fetch
      return fetch(url, options);
    },
  });
  createMainWindow();
  loadJobHistory();
  loadPrinterInfo();
  initializePrinters();
  setupIpcHandlers();
  loadMetrics();
  loadDailyMetrics();

  // Check for saved session after window is created
  checkForSavedSession();

  setupAutoUpdater();
});

// Update the setupAutoUpdater function
function setupAutoUpdater() {
    console.log("Setting up auto-updater...");
    const isDev = require("electron-is-dev");
    
    // Configure logger
    autoUpdater.logger = require("electron-log");
    autoUpdater.logger.transports.file.level = "info";
    
    // Log helper
    const logUpdate = (message) => {
        console.log(`[Update] ${message}`);
        if (mainWindow) {
            mainWindow.webContents.send('log-message', `[Update] ${message}`);
        }
    };

    if (isDev) {
        logUpdate('Running in development mode - auto updates disabled');
        console.log('Auto-updater disabled in development mode');
        mainWindow?.webContents.send('update-status', { 
            status: 'disabled',
            reason: 'Development mode'
        });
        return;
    }

    // Production configuration
    try {
        autoUpdater.autoDownload = false;
        autoUpdater.allowDowngrade = false;
        autoUpdater.allowPrerelease = false;

        // Event handlers
        autoUpdater.on('checking-for-update', () => {
            logUpdate('Checking for updates...');
            mainWindow?.webContents.send('update-status', { status: 'checking' });
        });

        autoUpdater.on('update-available', (info) => {
            logUpdate(`Update available: ${info.version}`);
            mainWindow?.webContents.send('update-status', { 
                status: 'available',
                info: info
            });
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Update Available',
                message: `Version ${info.version} is available. Would you like to download it?`,
                buttons: ['Yes', 'No']
            }).then(({response}) => {
                if (response === 0) {
                    autoUpdater.downloadUpdate();
                }
            });
        });

        autoUpdater.on('update-not-available', (info) => {
            logUpdate('No updates available');
            mainWindow?.webContents.send('update-status', { 
                status: 'not-available',
                info: info
            });
        });

        autoUpdater.on('error', (err) => {
            logUpdate(`Error in auto-updater: ${err.message}`);
            mainWindow?.webContents.send('update-status', { 
                status: 'error',
                error: err.message
            });
        });

        autoUpdater.on('download-progress', (progressObj) => {
            const message = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
            logUpdate(message);
            mainWindow?.webContents.send('update-status', { 
                status: 'downloading',
                progress: progressObj
            });
        });

        autoUpdater.on('update-downloaded', (info) => {
            logUpdate(`Update downloaded: ${info.version}`);
            mainWindow?.webContents.send('update-status', { 
                status: 'downloaded',
                info: info
            });

            dialog.showMessageBox(mainWindow, {
                type: 'info',
                buttons: ['Restart Now', 'Later'],
                title: 'Update Ready',
                message: 'A new version has been downloaded. Restart to install?',
                detail: `Version ${info.version} is ready to install.`
            }).then(({response}) => {
                if (response === 0) {
                    autoUpdater.quitAndInstall(true, true);
                }
            });
        });

        // Initial check
        logUpdate('Performing initial update check...');
        autoUpdater.checkForUpdates().catch(err => {
            logUpdate(`Initial update check failed: ${err.message}`);
        });

        // Check every hour
        setInterval(() => {
            logUpdate('Performing scheduled update check...');
            autoUpdater.checkForUpdates().catch(err => {
                logUpdate(`Scheduled update check failed: ${err.message}`);
            });
        }, 60 * 60 * 1000);

    } catch (error) {
        logUpdate(`Error setting up auto-updater: ${error.message}`);
    }
}

// ipcMain handlers
function setupIpcHandlers() {
  ipcMain.handle("get-printers", getPrinters);
  ipcMain.on("update-discarded-printers", updateDiscardedPrinters);
  ipcMain.on("update-printer-paper-levels", updatePrinterPaperLevels);
  ipcMain.on("process-print-job", processPrintJob);
  ipcMain.on("toggle-websocket", toggleWebSocket);
  ipcMain.handle("get-job-history", () => {
    try {
        return [...jobHistory.values()];
    } catch (error) {
        log(`Error fetching job history: ${error.message}`);
        return [];
    }
  });
  ipcMain.handle("get-metrics", () => {
    try {
        console.log("Fetching metrics...", metrics);
        return metrics;
    } catch (error) {
        log(`Error fetching metrics: ${error.message}`);
        return {
            totalPages: 0,
            monochromeJobs: 0,
            colorJobs: 0,
            totalIncome: 0,
        };
    }
  });
  ipcMain.handle("get-daily-metrics", () => {
    try {
      return dailyMetrics;
    } catch (error) {
      log(`Error fetching daily metrics: ${error.message}`);
      return {};
    }
  });
  ipcMain.on('check-for-updates', () => {
    autoUpdater.checkForUpdatesAndNotify();
  });
  ipcMain.on("login", handleLogin);
  ipcMain.on("test-login", handleTestLogin);
  ipcMain.on("signup", handleSignup);
  ipcMain.on("sign-out", handleSignOut);
  ipcMain.on("save-kyc-data", handleSaveKycData);

  ipcMain.on("fetch-shop-info", (_event, userEmail) => fetchShopInfo(userEmail));
  ipcMain.on("update-shop-info", (_event, updatedInfo) => updateShopInfo(updatedInfo));

  ipcMain.handle("fetch-shop-info", async (_event, userEmail) => {
    try {
      const { data, error } = await supabase
        .from("shop_accounts")
        .select(
          "shop_name, owner_name, contact_number, email, address, city, state, pincode, gst_number"
        )
        .eq("email", userEmail)
        .single();

      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  // Add to main.js in the setupIpcHandlers function
  ipcMain.handle("update-printer-capabilities", async (_event, capabilityChanges) => {
    try {
        // Process each printer's capability changes
        for (const [printerName, changes] of Object.entries(capabilityChanges)) {
            if (!printerInfo.capabilities[printerName]) {
                log(`Warning: Trying to update capabilities for unknown printer: ${printerName}`);
                continue;
            }

            // Update job routing rules
            if (changes.capabilities) {
                // Color job routing
                if ('colorJobsOnly' in changes.capabilities) {
                    printerInfo.capabilities[printerName].colorJobsOnly = changes.capabilities.colorJobsOnly;
                }
                
                if ('monochromeJobsOnly' in changes.capabilities) {
                    printerInfo.capabilities[printerName].monochromeJobsOnly = changes.capabilities.monochromeJobsOnly;
                }
                
                // Duplex job routing
                if ('duplexJobsOnly' in changes.capabilities) {
                    printerInfo.capabilities[printerName].duplexJobsOnly = changes.capabilities.duplexJobsOnly;
                }
                
                if ('simplexJobsOnly' in changes.capabilities) {
                    printerInfo.capabilities[printerName].simplexJobsOnly = changes.capabilities.simplexJobsOnly;
                }
            }

            // Update paper sizes if they've changed
            if (changes.paperSizes && changes.paperSizes.length > 0) {
                // Get the original physical paper sizes
                const physicalPaperSizes = Array.from(printerInfo.capabilities[printerName].paperSizes);
                
                // Filter requested paper sizes to only include physically supported ones
                const validPaperSizes = changes.paperSizes.filter(size => 
                    physicalPaperSizes.includes(size)
                );
                
                // Update the paper sizes
                printerInfo.capabilities[printerName].paperSizes = new Set(validPaperSizes);

                // Ensure paper levels exist for all supported paper sizes
                validPaperSizes.forEach(size => {
                    if (!printerInfo.paperLevels[printerName][size]) {
                        printerInfo.paperLevels[printerName][size] = 0;
                    }
                });
            }
        }

        // Save the updated printerInfo
        savePrinterInfo();
        log('Printer capabilities updated successfully');

        // Notify renderer about the updated printer info
        mainWindow.webContents.send("printer-info-updated", {
            printerInfo,
            printerQueues: Object.fromEntries(printerQueues)
        });

        // Update the shop's technical info (supported settings)
        updateShopTechnicalInfo();
        
        return { success: true };
        
    } catch (error) {
        log(`Error updating printer capabilities: ${error.message}`);
        return { success: false, error: error.message };
    }
});
ipcMain.on("update-printer-capabilities", (_event, capabilityChanges) => {
  try {
      // Process each printer's capability changes
      for (const [printerName, changes] of Object.entries(capabilityChanges)) {
          if (!printerInfo.capabilities[printerName]) {
              log(`Warning: Trying to update capabilities for unknown printer: ${printerName}`);
              continue;
          }

          // Update basic capabilities
          for (const [capability, value] of Object.entries(changes.capabilities)) {
              printerInfo.capabilities[printerName][capability] = value;
          }

          // Update paper sizes if they've changed
          if (changes.paperSizes && changes.paperSizes.length > 0) {
              printerInfo.capabilities[printerName].paperSizes = new Set(changes.paperSizes);

              // Update paper levels for new paper sizes
              changes.paperSizes.forEach(size => {
                  if (!printerInfo.paperLevels[printerName][size]) {
                      printerInfo.paperLevels[printerName][size] = 0;
                  }
              });

              // Remove paper levels for removed paper sizes
              Object.keys(printerInfo.paperLevels[printerName]).forEach(size => {
                  if (!changes.paperSizes.includes(size)) {
                      delete printerInfo.paperLevels[printerName][size];
                  }
              });
          }
      }

      // Save the updated printerInfo
      savePrinterInfo();
      log('Printer capabilities updated successfully');

      // Notify renderer about the updated printer info
      mainWindow.webContents.send("printer-info-updated", {
          printerInfo,
          printerQueues: Object.fromEntries(printerQueues)
      });

      // Update the shop's technical info (supported settings)
      updateShopTechnicalInfo();
      
  } catch (error) {
      log(`Error updating printer capabilities: ${error.message}`);
  }
});

  // Add this line to the existing handlers
  ipcMain.handle("check-session-status", () => {
    return {
      hasSession: !!currentUser,
      user: currentUser
    };
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});