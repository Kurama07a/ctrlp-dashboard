const { app, BrowserWindow, ipcMain, dialog } = require("electron");
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
const { autoUpdater } = require("electron-updater");
const SessionManager = require("./sessionManager"); 
const win32 = require("win32-api"); 
const say = require("say")
const FIXED_PAPER_SIZES = ["A4", "A3", "Letter", "Legal"];
const JOB_HISTORY_FILE = path.join(app.getPath("userData"), "jobHistory.json");
const METRICS_FILE = path.join(app.getPath("userData"), "metrics.json");
const DAILY_METRICS_FILE = path.join(
  app.getPath("userData"),
  "dailyMetrics.json"
);
const PRINTER_INFO_FILE = path.join(
  app.getPath("userData"),
  "printerInfo.json"   
);
 // Replace with your WebSocket URL
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
let localPrinterWs = null;
let localPrinterReconnectTimer = null;
let soundSettings = {
    soundEnabled: true,
    volume: 75,
    jobCompletionSoundEnabled: true
};
let shop={}
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
  if (mainWindow) mainWindow.webContents.send("log-message", message);
}

// Add a helper for KYC logging
function logKyc(message, data) {
  const msg = `[KYC] ${message}` + (data ? ` | ${JSON.stringify(data)}` : "");
  console.log(msg);
  try {
    if (mainWindow) mainWindow.webContents.send("log-message", msg);
  } catch (e) { }
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
      log(`Created new daily metrics entry for ${today}`);
    }
    
    const pagesUsed = job.number_of_pages;
    dailyMetrics[today].totalPages += pagesUsed;
    
    // Determine page cost based on color mode
    if (job.color_mode.toLowerCase() === "color") {
      dailyMetrics[today].colorJobs++;
    } else {
      dailyMetrics[today].monochromeJobs++;
    }    
    dailyMetrics[today].totalIncome += job.amount;
    log(`Updated daily metrics for ${today}: Total income is now ₹${dailyMetrics[today].totalIncome.toFixed(2)}`);
    
    saveDailyMetrics();
    mainWindow.webContents.send("daily-metrics-updated", dailyMetrics);
  }
}

function updateMetrics(job) {
  if (job.print_status === "completed") {
    const pagesUsed = job.number_of_pages;
    log(`Job ${job.id}: Updating overall metrics with ${pagesUsed} pages`);
    metrics.totalPages += pagesUsed;
    
    // Determine page cost based on color mode
    let pageCost = 0;
    if (job.color_mode.toLowerCase() === "color") {
      metrics.colorJobs++;
    } else {
      metrics.monochromeJobs++;
    }
    
    // Calculate commission percentage (default to 20% if not set)
    metrics.totalIncome += job.amount;
    log(`Updated overall metrics: Total income is now ₹${metrics.totalIncome.toFixed(2)}`);
    
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
    simplexJobsOnly: false,
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

async function getPrintersFromWmic() {
  try {
    const { stdout } = await execAsync('wmic printer get name');
    return stdout
      .split('\n')
      .slice(1)
      .map(name => name.trim())
      .filter(name => name.length > 0)
      .map(name => ({ name }));
  } catch (error) {
    log('WMIC printer detection failed:', error.message);
    return [];
  }
}

async function getPrintersFromPowerShell() {
  const ps_script = `
  $printers = Get-WmiObject Win32_Printer | Where-Object { $_.PortName -like 'USB*' }
  $pnpDevices = Get-WmiObject Win32_PnPEntity | Where-Object { 
      $_.PNPDeviceID -like 'USB\\*' -or $_.PNPDeviceID -like 'USBPRINT\\*' 
  }

  $results = @()
  foreach ($printer in $printers) {
      $usbDevice = $pnpDevices | Where-Object { 
          $_.PNPDeviceID -eq $printer.PNPDeviceID -and $_.PNPDeviceID -like 'USB\\*' 
      } | Select-Object -First 1
      
      if ($null -eq $usbDevice) {
          $usbDevice = $pnpDevices | Where-Object { 
              $_.PNPDeviceID -like 'USBPRINT\\*' -and $_.PNPDeviceID -like "*$($printer.Name)*" 
          } | Select-Object -First 1
      }

      $printerInfo = @{
          name = $printer.Name
          port = $printer.PortName
          deviceId = $printer.DeviceID
          status = $printer.PrinterStatus
          driverName = $printer.DriverName
          location = if ($null -eq $printer.Location) { "Unknown" } else { $printer.Location }
          isConnected = if ($null -eq $usbDevice) { $false } else { $true }
          busAddress = if ($null -eq $usbDevice) { "Not Connected" } else { $usbDevice.PNPDeviceID }
      }
      $results += $printerInfo
  }
  ConvertTo-Json -InputObject $results -Compress
  `;

  try {
    const scriptPath = path.join(app.getPath('temp'), 'printer_check.ps1');
    await fsPromises.writeFile(scriptPath, ps_script);

    const { stdout } = await execAsync(
      `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`,
      { maxBuffer: 1024 * 1024 }
    );

    await fsPromises.unlink(scriptPath);

    const printers = JSON.parse(stdout);
    return printers.filter(printer => 
      printer.isConnected && 
      printer.busAddress !== 'Not Connected' &&
      printer.status !== 3
    );
  } catch (error) {
    log('PowerShell printer detection failed:', error.message);
    return [];
  }
}
function hasValidPrinters() {
  const availablePrinters = Object.keys(printerInfo.capabilities);
  const nonDiscardedPrinters = availablePrinters.filter(
    printer => !printerInfo.discardedPrinters.includes(printer)
  );
  return nonDiscardedPrinters.length > 0;
}

async function getPrintersFromWin32() {
  try {
    const printers = [];
    const user32 = win32.load('user32');
    const winspool = win32.load('winspool.drv');
    
    // Use EnumPrinters function to get printer list
    const level = 2;
    const flags = 4; // PRINTER_ENUM_LOCAL
    const printerInfo = await winspool.EnumPrinters(flags, null, level);
    
    for (const printer of printerInfo) {
      printers.push({ name: printer.pPrinterName });
    }
    return printers;
  } catch (error) {
    log('Win32 printer detection failed:', error.message);
    return [];
  }
}

async function getPrintersFromSystem32() {
  try {
    const { stdout } = await execAsync('powershell.exe Get-Printer | Format-List Name');
    return stdout
      .split('\n')
      .filter(line => line.startsWith('Name :'))
      .map(line => ({ name: line.replace('Name :', '').trim() }));
  } catch (error) {
    log('System32 printer detection failed:', error.message);
    return [];
  }
}


async function initializePrinters() {
  try {
    let allPrinters = [];
    
    // Method 1: PDF to Printer library
    log('Attempting to detect printers using pdf-to-printer...');
    allPrinters = await getPrintersFromWmic();
    
    // Method 2: PowerShell if first method fails
    if (!allPrinters.length) {
      log('Trying PowerShell detection method...');
      allPrinters = await getPrintersFromPowerShell();
    }

    // Method 3: WMIC if previous methods fail
    if (!allPrinters.length) {
      log('Trying WMIC detection method...');
      allPrinters = await pdfToPrinter.getPrinters();
    }

    // Method 4: Win32 API if previous methods fail
    if (!allPrinters.length) {
      log('Trying Win32 API detection method...');
      allPrinters = await getPrintersFromWin32();
    }

    // Method 5: System32 PowerShell as last resort
    if (!allPrinters.length) {
      log('Trying System32 PowerShell detection method...');
      allPrinters = await getPrintersFromSystem32();
    }

    // If still no printers found, notify user and exit
    if (!allPrinters.length) {
      log('No printers detected using any available method');
      mainWindow.webContents.send("printer-status", {
        status: "error",
        message: "No physical printers detected"
      });
      
      // Close WebSocket if connected
      if (webSocket && webSocket.readyState === WebSocket.OPEN) {
        closeWebSocket();
        mainWindow.webContents.send("force-toggle-websocket", false);
      }
      return;
    }

    log(`Detected ${allPrinters.length} printers, filtering physical printers...`);
    const physicalPrinters = filterPhysicalPrinters(allPrinters);
    log(`Found ${physicalPrinters.length} physical printers`);

    // Initialize capabilities and queues for each physical printer
    for (const printer of physicalPrinters) {
      if (!printerInfo.capabilities[printer.name]) {
        log(`Detecting capabilities for printer: ${printer.name}`);
        const capabilities = await detectPrinterCapabilities(printer.name);
        printerInfo.capabilities[printer.name] = capabilities;
        printerInfo.paperLevels[printer.name] = {};
        capabilities.paperSizes.forEach((size) => {
          printerInfo.paperLevels[printer.name][size] =
            printerInfo.paperLevels[printer.name][size] || 0;
        });
        log(`Initialized capabilities for ${printer.name}`);
      }
      
      if (!printerQueues.has(printer.name)) {
        printerQueues.set(printer.name, []);
        log(`Initialized print queue for ${printer.name}`);
      }
    }

    // Clean up disconnected printers
    for (const printerName of Object.keys(printerInfo.capabilities)) {
      if (!physicalPrinters.some((p) => p.name === printerName)) {
        log(`Removing disconnected printer: ${printerName}`);
        delete printerInfo.capabilities[printerName];
        delete printerInfo.paperLevels[printerName];
        printerQueues.delete(printerName);
      }
    }

    savePrinterInfo();
    log('Printer information saved successfully');
    
    mainWindow.webContents.send("printer-info-updated", {
      printerInfo,
      printerQueues: Object.fromEntries(printerQueues),
    });
    
  } catch (error) {
    log(`Error initializing printers: ${error.message}`);
    mainWindow.webContents.send("printer-status", {
      status: "error",
      message: `Failed to initialize printers: ${error.message}`
    });
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
    pages_printed: job.number_of_pages + 1,
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

    const allPrinters = Object.keys(printerInfo.capabilities).map(printerName => ({
    name: printerName,
    deviceId: printerName
  }));
    console.log('printerinfo', printerInfo)
    console.log('line 697', allPrinters)
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

    printerQueues
      .get(bestPrinter.name)
      .push({ ...job, print_status: "received" });
    this.processing.add(job.id);
    mainWindow.webContents.send(
      "printer-queues-updated",
      Object.fromEntries(printerQueues)
    );

    setTimeout(() => this.processQueue(bestPrinter.name), 0);
    return bestPrinter;
  }

  // Replace the existing filterValidPrinters method in JobScheduler class

  filterValidPrinters(printers, job) {
    return printers.filter((printer) => {
      const caps = printerInfo.capabilities[printer.name];
      const paperLevels = printerInfo.paperLevels[printer.name];
      const pagesNeeded = job.number_of_pages + 1;

      // Basic capability checks
      if (
        !caps ||
        !paperLevels ||
        printerInfo.discardedPrinters.includes(printer.name) ||
        !caps.paperSizes.has(job.paper_size) ||
        paperLevels[job.paper_size] < pagesNeeded
      ) {
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
  // First get all compatible printers
  const compatiblePrinters = printers.filter(printer => {
    const caps = printerInfo.capabilities[printer.name];
    const isDiscarded = printerInfo.discardedPrinters.includes(printer.name);
    
    // Basic compatibility check
    return !isDiscarded && 
           caps.paperSizes.has(job.paper_size) &&
           this.checkRoutingRules(caps, job);
  });

  // If no compatible printers, return null
  if (compatiblePrinters.length === 0) {
    return null;
  }

  // If only one compatible printer, use it regardless of queue
  if (compatiblePrinters.length === 1) {
    return compatiblePrinters[0];
  }

  // For multiple compatible printers, use scoring system
  const scoredPrinters = compatiblePrinters.map(printer => {
    const caps = printerInfo.capabilities[printer.name];
    const paperLevel = printerInfo.paperLevels[printer.name][job.paper_size] || 0;
    const queueLength = printerQueues.get(printer.name)?.length || 0;

    // Base score starts at 100
    let score = 100;

    // Paper level impact (0-30 points)
    const paperScore = this.calculatePaperScore(paperLevel, job.number_of_pages);
    score += (paperScore * 0.3);

    // Capability match impact (0-40 points)
    const capabilityScore = this.calculateCapabilityScore(caps, job);
    score += (capabilityScore * 0.4);

    // Queue length impact (-30 to 0 points)
    // Only affects selection between multiple printers
    const queuePenalty = Math.min(queueLength * 10, 30);
    score -= queuePenalty;

    return {
      printer,
      score,
      metrics: {
        paperLevel,
        queueLength,
        paperScore,
        capabilityScore,
        queuePenalty,
        finalScore: score
      }
    };
  });

  // Sort by score and log selection metrics
  scoredPrinters.sort((a, b) => b.score - a.score);
  this.logPrinterSelection(job, scoredPrinters);

  // Always return the highest scoring printer
  return scoredPrinters[0].printer;
}

calculatePaperScore(paperLevel, pagesNeeded) {
  if (paperLevel < pagesNeeded) return 0;
  const ratio = paperLevel / pagesNeeded;
  return Math.min(ratio * 20, 100);
}

calculateCapabilityScore(caps, job) {
  let score = 50; // Base score
  
  // Color matching bonus
  if (job.color_mode.toLowerCase() === "color" && caps.color) score += 25;
  if (job.color_mode.toLowerCase() === "monochrome" && !caps.color) score += 25;
  
  // Duplex matching bonus
  if (job.duplex !== "simplex" && caps.duplex) score += 25;
  if (job.duplex === "simplex" && !caps.duplex) score += 25;
  
  return score;
}

checkRoutingRules(caps, job) {
  // Essential compatibility checks
  if (caps.colorJobsOnly && job.color_mode.toLowerCase() !== "color") return false;
  if (caps.monochromeJobsOnly && job.color_mode.toLowerCase() === "color") return false;
  if (caps.duplexJobsOnly && job.duplex === "simplex") return false;
  if (caps.simplexJobsOnly && job.duplex !== "simplex") return false;
  return true;
}

// Update the logPrinterSelection method in the JobScheduler class
logPrinterSelection(job, validPrinters) {
  console.log(`Printer selection for job ${job.id}:`);
  validPrinters.forEach(({ printer, metrics }) => {
    // Ensure all metrics exist before formatting
    const formattedMetrics = {
      finalScore: metrics?.finalScore?.toFixed(2) ?? 'N/A',
      paper: metrics?.paperLevel ? 
        `${metrics.paperLevel} sheets (${metrics.paperScore?.toFixed(2) ?? 'N/A'})` : 'N/A',
      queue: metrics?.queueLength !== undefined ? 
        `${metrics.queueLength} jobs (${metrics.queuePenalty?.toFixed(2) ?? 'N/A'})` : 'N/A',
      capability: metrics?.capabilityScore?.toFixed(2) ?? 'N/A'
    };

    console.log(`${printer.name}:`, formattedMetrics);
  });
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
    mainWindow.webContents.send(
      "printer-queues-updated",
      Object.fromEntries(printerQueues)
    );

    try {
      const filePath = await downloadFileFromSupabase(job.combined_file_path);
      const printOptions = createPrintOptions(job, { name: printerName });

      log(
        `Printing job ${job.id} with options: ${JSON.stringify(printOptions)}`
      );
      await printJobWithWrappers(filePath, printOptions, job);

      updatePaperLevels(printerName, job.paper_size, -job.number_of_pages - 2);

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
      //playJobCompletionSound(job.id, printerName);
      sendMessage(completedUpdate.type, completedUpdate.data);
      mainWindow.webContents.send("print-complete", job.id);
      mainWindow.webContents.send(
        "printer-queues-updated",
        Object.fromEntries(printerQueues)
      );
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
      mainWindow.webContents.send(
        "printer-queues-updated",
        Object.fromEntries(printerQueues)
      );
    }
  }
}
function playJobCompletionSound(jobId, printerName) {
    try {
        if (!soundSettings.jobCompletionSoundEnabled) {
            log(`Job completion sound disabled for job ${jobId}`);
            return;
        }
        
        log(`Playing audio notification for job ${jobId}`);
        
        // Use different parameters based on platform
        const platform = process.platform;
        
        if (platform === 'win32') {
            // Windows
            say.speak(`Print job started successfully on printer ${printerName}`, null, soundSettings.volume / 100);
        } else if (platform === 'darwin') {
            // macOS
            say.speak(`Print job ${jobId} completed successfully`, null, soundSettings.volume / 100, (err) => {
                if (err) {
                    log(`Error playing audio notification: ${err.message}`);
                }
            });
        } else {
            // Linux and others
            say.speak(`Print job ${jobId} completed successfully`, null, soundSettings.volume / 100, (err) => {
                if (err) {
                    log(`Error playing audio notification: ${err.message}`);
                }
            });
        }
    } catch (error) {
        log(`Error playing job completion sound: ${error.message}`);
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
    let coverPage = 0;
    // Load the PDF to determine the total number of pages
    const pdfBytes = await fs.promises.readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();
    if(job.number_of_pages/job.copies < totalPages) 
      coverPage = 1;
    // Check if we need special handling for landscape or duplex
    const needsSpecialHandling =
      (printOptions.orientation === "landscape" ||
      (job.duplex && job.duplex !== "simplex") ||
      printOptions.copies > 1) && coverPage === 1;

    if (needsSpecialHandling) {
      // Print the first page (cover invoice) with default settings
      const firstPageOptions = {
        printer: printOptions.printer,
        pages: "1",
        copies: 1,
        monochrome: true,
      };
      

      // Print the main content with the provided print options
      const mainContentOptions = {
        ...printOptions,
        pages: `2-${totalPages}`,
      };
      await pdfToPrinter.print(filePath, mainContentOptions);
      log(`Printed the main content for job ${job.id}`);

      await pdfToPrinter.print(filePath, firstPageOptions);
      log(`Printed the first page (cover) for job ${job.id}`);
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


// Helper function to create a blank page
async function createBlankPage() {
  const pdfDoc = await PDFDocument.create();
  // Default to A4 size
  pdfDoc.addPage([595, 842]); // A4 size in points
  
  // Save the blank PDF to a temporary file
  const blankPdfBytes = await pdfDoc.save();
  const blankPdfPath = path.join(TEMP_DIR, `blank-${Date.now()}.pdf`);
  await fsPromises.writeFile(blankPdfPath, blankPdfBytes);
  
  return blankPdfPath;
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
    pages: `${job.start_page || 1}-${job.end_page || job.number_of_pages + 1}`,
    copies: Math.min(job.copies, caps.maxCopies),
    // side: caps.duplex ? getDuplexMode(job.duplex) : "simplex"
    monochrome: job.color_mode.toLowerCase() === "monochrome" || !caps.color,
    paperSize: caps.paperSizes.has(job.paper_size) ? job.paper_size : "A4",
    orientation: job.orientation.toLowerCase(),
    resolution: caps.supportedResolutions[0],
  };
}



function toggleWebSocket(_event, connect) {
  if (connect) {
    // Check for valid printers before allowing connection
    if (!hasValidPrinters()) {
      log("Cannot initialize WebSocket: No valid printers available");
      mainWindow.webContents.send("websocket-status", {
        status: "error",
        message: "No physical printers detected. Please connect a printer first."
      });
      mainWindow.webContents.send("force-toggle-websocket", false);
      return;
    }
    initializeWebSocket();
  } else {
    closeWebSocket();
  }
  isConnected = connect;
}


function initializeWebSocket() {

   if (!hasValidPrinters()) {
    log("Cannot initialize WebSocket: No valid printers available");
    mainWindow.webContents.send("websocket-status", {
      status: "error",
      message: "No physical printers detected"
    });
    return;
  }

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
            sendMessage("JOB_RECEIVED", {
              shopId: currentShopId,
              jobId: job.id,
              status: "received",
            });
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

  if (localPrinterWs) {
    localPrinterWs.close();
    localPrinterWs = null;
  }
  if (localPrinterReconnectTimer) {
    clearInterval(localPrinterReconnectTimer);
    localPrinterReconnectTimer = null;
  }
}

function sendMessage(type, data) {
  if (webSocket && webSocket.readyState === WebSocket.OPEN) {
    const message = JSON.stringify({ type, data });
    webSocket.send(message);
    log(`Sent ${type} message: ${JSON.stringify(data)}`);
  }
}

// Modify handleLogin to save user session
// ...existing code...

async function handleLogin(event, { email, password }) {
  try {
    const { data: account, error: accountError } = await supabase
      .from("shop_accounts")
      .select("id, shop_name, email, secret, shop_id")
      .eq("email", email)
      .eq("secret", password)
      .single();

    if (accountError) throw accountError;
    
    // Fetch complete shop data (from both tables)
    const shopDataResult = await fetchCompleteShopData(email);
    if (!shopDataResult.success) {
      throw new Error(shopDataResult.error);
    }
    
    // Set kyc_verified based on shop_id and other potential factors
    let kyc_verified = false;
    if (account.shop_id && shop.id) {
      kyc_verified = true;
    }
    
    currentShopId = account.shop_id || null;
    currentSecret = account.secret;

    const user = {
      id: account.id,
      shop_name: account.shop_name,
      email: account.email,
      shop_id: account.shop_id || null,
      kyc_verified,
      secret: account.secret,
      shop_color_cost: shop.shop_color_cost,
      shop_bw_cost: shop.shop_bw_cost, 
      shop_commission: shop.shop_commission
    };
    
    // Save the user session
    sessionManager.saveSession(user);
    currentUser = user;
    mainWindow.webContents.send("clear-auth-error");
    event.reply("auth-success", user);
    log(`User logged in: ${user.email}, KYC verified: ${kyc_verified}`);

    if (kyc_verified) {
      mainWindow.webContents.send("kyc-verified");
    } else {
      mainWindow.webContents.send("kyc-required");
    }
    log("User session saved:", user);
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
      secret: "test-secret",
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

    for (const [printerName, capabilities] of Object.entries(
      printerInfo.capabilities
    )) {
      if (printerInfo.discardedPrinters.includes(printerName)) {
        continue; // Skip discarded printers
      }

      const paperSizes = Array.from(
        capabilities.paperSizes || FIXED_PAPER_SIZES
      );
      const supportedPrintSettings = [];

      // Generate printsettings_code for each combination of capabilities
      for (const paperType of paperSizes) {
        for (const orientation of ["portrait", "landscape"]) {
          for (const color of printerInfo.capabilities[printerName].color
            ? [true, false]
            : [false]) {
            for (const doubleSided of printerInfo.capabilities[printerName]
              .duplex
              ? [true, false]
              : [false]) {
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
  if (settings.orientation === "landscape") {
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

  const paperTypeCode =
    PaperType[settings.paperType.toUpperCase()] || PaperType.A4;
  code += paperTypeCode * 1000;

  return code;
}
async function fetchCompleteShopData(userEmail) {
  try {
    log(`Fetching complete shop data for ${userEmail}`);
    
    // First fetch basic shop account data
    const { data: accountData, error: accountError } = await supabase
      .from("shop_accounts")
      .select("*")
      .eq("email", userEmail)
      .single();
      
    if (accountError) throw accountError;
    
    // Store the shop account data
    shopInfo = {
      id: accountData.id,
      shop_name: accountData.shop_name || "Not Provided",
      owner_name: accountData.owner_name || "Not Provided",
      contact_number: accountData.contact_number || "Not Provided",
      email: accountData.email || "Not Provided",
      address: accountData.address || "Not Provided",
      city: accountData.city || "Not Provided",
      state: accountData.state || "Not Provided",
      pincode: accountData.pincode || "Not Provided",
      gst_number: accountData.gst_number || "Not Provided",
      kyc_status: accountData.kyc_status || "waiting for document upload",
      updated_at: accountData.updated_at || new Date().toISOString(),
      shop_id: accountData.shop_id || null,
      // Add any other fields from shop_accounts you need
    };
    
    let shopData = {};
    
    // If there's a shop_id, fetch the associated print_shops data
    if (accountData.shop_id) {
      const { data: printShopData, error: shopError } = await supabase
        .from("print_shops")
        .select("*")
        .eq("id", accountData.shop_id)
        .single();
        
      if (!shopError && printShopData) {
        shopData = printShopData;
        
        // Update shop variable with the latest data
        shop = printShopData;
        
        // Combine shop info with printShopData for comprehensive info
        shopInfo = {
          ...shopInfo,
          shop_bw_cost: printShopData.shop_bw_cost,
          shop_color_cost: printShopData.shop_color_cost,
          shop_commission: printShopData.shop_commission,
          supported_settings: printShopData.supported_settings,
          cover_page_mode: printShopData.cover_page_mode
          // Add any other fields from print_shops you need
        };
        
        log(`Fetched complete shop data for ${userEmail} with shop ID ${accountData.shop_id}`);
      } else {
        log(`Shop with ID ${accountData.shop_id} not found or error: ${shopError?.message}`);
      }
    }
    
    // Send the updated shop info to the renderer
    mainWindow.webContents.send("shop-info-fetched", shopInfo);
    
    return {
      success: true, 
      data: shopInfo,
      accountData: accountData,
      shopData: shopData
    };
  } catch (error) {
    log(`Error fetching complete shop data: ${error.message}`);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

async function fetchShopInfo(userEmail) {
  const result = await fetchCompleteShopData(userEmail);
  
  if (!result.success) {
    // Handle failure case like before
    mainWindow.webContents.send("shop-info-fetched", { error: result.error });
    
    currentShopId = null;
    currentSecret = null;
    currentUser = null;
    sessionManager.clearSession();
    mainWindow.webContents.send(
      "auth-error",
      "Session expired. Please log in again."
    );
    closeWebSocket();
  }
  
  return result;
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
    console.log(
      `Uploading to bucket: ${bucketName}, filePath: ${filePath}, fileName: ${fileName}`
    );
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`Invalid file path: ${filePath}`);
    }

    const fileContent = fs.readFileSync(filePath); // Read as binary

    let contentType;
    if (filePath.endsWith(".pdf")) {
      contentType = "application/pdf";
    } else if (filePath.endsWith(".png")) {
      contentType = "image/png";
    } else if (filePath.endsWith(".jpg") || fileName.endsWith(".jpeg")) {
      contentType = "image/jpeg";
    } else {
      contentType = "application/octet-stream"; // Default for unknown types
    }

    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(fileName, fileContent, {
        contentType: contentType,
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
  
  mainWindow.loadFile("src/index.html");
    mainWindow.webContents.on('did-finish-load', () => {
    checkForSavedSession();});


}

// Update the checkForSavedSession function
// main.js
// ...existing code...

async function checkForSavedSession() {
  try {
    const savedUser = sessionManager.loadSession();
    if (!savedUser) {
      console.log('No saved session found');
      mainWindow.webContents.send('session-check-complete');
      return;
    }

    console.log('Found saved session, attempting to restore...');

    // Set current user data from saved session
    currentUser = savedUser;
    currentShopId = savedUser.shop_id || null;
    currentSecret = savedUser.secret;
    console.log('Current user:', currentUser);

    try {
      // Try to verify the session by fetching complete shop data
      const shopDataResult = await fetchCompleteShopData(savedUser.email);

      if (shopDataResult.success) {
        // ...existing code for successful restore...
        currentUser = {
          ...currentUser,
          shop_color_cost: shop.shop_color_cost,
          shop_bw_cost: shop.shop_bw_cost,
          shop_commission: shop.shop_commission,
          cover_page_mode: shop.cover_page_mode
        };
        sessionManager.saveSession(currentUser);
        mainWindow.webContents.send('auth-success', currentUser);
        const kyc_verified = !!(savedUser.shop_id && shop.id);
        if (kyc_verified) {
          mainWindow.webContents.send('kyc-verified');
        } else {
          mainWindow.webContents.send('kyc-required');
        }
        log(`Session restored successfully for ${savedUser.email}`);
      } else {
        // If error is due to network, keep session and notify offline
        if (
          shopDataResult.error &&
          (
            shopDataResult.error.toLowerCase().includes('network') ||
            shopDataResult.error.toLowerCase().includes('offline') ||
            shopDataResult.error.toLowerCase().includes('fetch') ||
            shopDataResult.error.toLowerCase().includes('timeout')
          )
        ) {
          log('Offline: Could not verify session, but keeping saved session.');
          mainWindow.webContents.send('offline-session', currentUser);
          // Optionally, send a UI notification about offline mode
        } else {
          // Only clear session for non-network errors
          throw new Error(shopDataResult.error);
        }
      }
    } catch (error) {
      console.error('Failed to verify session:', error);
      // Only clear session for non-network errors
      if (
        error.message &&
        (
          error.message.toLowerCase().includes('network') ||
          error.message.toLowerCase().includes('offline') ||
          error.message.toLowerCase().includes('fetch') ||
          error.message.toLowerCase().includes('timeout')
        )
      ) {
        log('Offline: Could not verify session, but keeping saved session.');
        mainWindow.webContents.send('offline-session', currentUser);
      } else {
        sessionManager.clearSession();
        currentUser = null;
        currentShopId = null;
        currentSecret = null;
        mainWindow.webContents.send('session-check-complete');
      }
    }
  } catch (error) {
    console.error('Error checking saved session:', error);
    mainWindow.webContents.send('session-check-complete');
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
  initializePrinters();
 
  loadJobHistory();
  loadPrinterInfo();
  
  setupIpcHandlers();
  loadMetrics();
  loadDailyMetrics();
  log("initializing local printer monitor"); 
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
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "kurama07a",
    repo: "ctrlp-dashboard",
    private: false,
  });

  // Optional: Add update channel
  autoUpdater.channel = "latest";

  // Log helper
  const logUpdate = (message) => {
    console.log(`[Update] ${message}`);
    if (mainWindow) {
      mainWindow.webContents.send("log-message", `[Update] ${message}`);
    }
  };

  if (isDev) {
    logUpdate("Running in development mode - auto updates disabled");
    console.log("Auto-updater disabled in development mode");
    mainWindow?.webContents.send("update-status", {
      status: "disabled",
      reason: "Development mode",
    });
    return;
  }

  // Production configuration
  try {
    autoUpdater.autoDownload = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;

    // Event handlers
    autoUpdater.on("checking-for-update", () => {
      logUpdate("Checking for updates...");
      mainWindow?.webContents.send("update-status", { status: "checking" });
    });

    autoUpdater.on("update-available", (info) => {
      logUpdate(`Update available: ${info.version}`);
      mainWindow?.webContents.send("update-status", {
        status: "available",
        info: info,
      });
      dialog
        .showMessageBox(mainWindow, {
          type: "info",
          title: "Update Available",
          message: `Version ${info.version} is available. Would you like to download it?`,
          buttons: ["Yes", "No"],
        })
        .then(({ response }) => {
          if (response === 0) {
            autoUpdater.downloadUpdate();
          }
        });
    });

    autoUpdater.on("update-not-available", (info) => {
      logUpdate("No updates available");
      mainWindow?.webContents.send("update-status", {
        status: "not-available",
        info: info,
      });
    });

    autoUpdater.on("error", (err) => {
      logUpdate(`Error in auto-updater: ${err.message}`);
      mainWindow?.webContents.send("update-status", {
        status: "error",
        error: err.message,
      });
    });

    autoUpdater.on("download-progress", (progressObj) => {
      const message = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
      logUpdate(message);
      mainWindow?.webContents.send("update-status", {
        status: "downloading",
        progress: progressObj,
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      logUpdate(`Update downloaded: ${info.version}`);
      mainWindow?.webContents.send("update-status", {
        status: "downloaded",
        info: info,
      });

      dialog
        .showMessageBox(mainWindow, {
          type: "info",
          buttons: ["Restart Now", "Later"],
          title: "Update Ready",
          message: "A new version has been downloaded. Restart to install?",
          detail: `Version ${info.version} is ready to install.`,
        })
        .then(({ response }) => {
          if (response === 0) {
            autoUpdater.quitAndInstall(true, true);
          }
        });
    });

    // Initial check
    logUpdate("Performing initial update check...");
    autoUpdater.checkForUpdates().catch((err) => {
      logUpdate(`Initial update check failed: ${err.message}`);
    });

    // Check every hour
    setInterval(() => {
      logUpdate("Performing scheduled update check...");
      autoUpdater.checkForUpdates().catch((err) => {
        logUpdate(`Scheduled update check failed: ${err.message}`);
      });
    }, 60 * 60 * 1000);
  } catch (error) {
    logUpdate(`Error setting up auto-updater: ${error.message}`);
  }
}

// ipcMain handlers
function setupIpcHandlers() {

  
  // Add this to your setupIpcHandlers() function

ipcMain.handle('request-payout', async (_event, payoutData) => {
  try {
    log(`Processing payout request for shop: ${payoutData.shopName}, amount: ₹${payoutData.payoutAmount}`);
    
    // Validate payout request
    if (Number(payoutData.payoutAmount) < 100) {
      return {
        success: false,
        error: "Payout amount must be at least ₹100"
      };
    }
    
    // Record payout request in daily metrics
    const today = payoutData.payoutDate;
    if (dailyMetrics[today]) {
      dailyMetrics[today].payout = payoutData.payoutAmount;
      saveDailyMetrics();
      
      // Send update to all windows
      mainWindow.webContents.send("daily-metrics-updated", dailyMetrics);
    }
    
    // Send email notification (dummy implementation)
    // In a real implementation, this would call your mail server API
    log(`Sending payout request email for ${payoutData.shopName}, amount: ₹${payoutData.payoutAmount}`);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Send payout notification to server if websocket is connected
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
      sendMessage("PAYOUT_REQUEST", {
        shopId: currentShopId,
        shopName: payoutData.shopName,
        shopEmail: payoutData.shopEmail,
        payoutAmount: payoutData.payoutAmount,
        payoutDate: today,
        bankDetails: payoutData.bankDetails
      });
    }
    
    return { 
      success: true,
      message: 'Payout request processed successfully'
    };
  } catch (error) {
    log(`Error processing payout request: ${error.message}`);
    return {
      success: false,
      error: error.message || 'Failed to process payout request'
    };
  }
});
ipcMain.on('retry-print-job', async (_event, { jobId, printerName }) => {
        try {
            // Find the job in job history
            const job = [...jobHistory.values()].find(j => j.id === jobId);
            if (!job) {
                log(`Retry failed: Job ${jobId} not found`);
                return;
            }

            // Prepare a copy of the job for re-print (do not update metrics)
            const retryJob = { ...job };
            retryJob.print_status = 'retrying';
            retryJob.processed_timestamp = new Date().toISOString();

            // Print directly to the selected printer
            const printOptions = createPrintOptions(retryJob, { name: printerName });
            try {
                const filePath = await downloadFileFromSupabase(retryJob.combined_file_path);
                await printJobWithWrappers(filePath, printOptions, retryJob);
                log(`Retried job ${jobId} on printer ${printerName} (no metrics updated)`);
                mainWindow.webContents.send('print-complete', jobId);
            } catch (err) {
                log(`Retry print failed for job ${jobId}: ${err.message}`);
                mainWindow.webContents.send('print-failed', jobId);
            }
        } catch (error) {
            log(`Error in retry-print-job: ${error.message}`);
        }
    });
ipcMain.handle('update-daily-metrics', async (_event, updatedMetrics) => {
  try {
    dailyMetrics = updatedMetrics;
    saveDailyMetrics();
    
    mainWindow.webContents.send('daily-metrics-updated', dailyMetrics);
    return { success: true };
  } catch (error) {
    log(`Error updating daily metrics: ${error.message}`);
    return { success: false, error: error.message };
  }
});
  ipcMain.handle("get-printers", getPrinters);
  ipcMain.on("update-discarded-printers", updateDiscardedPrinters);
  ipcMain.on("update-printer-paper-levels", updatePrinterPaperLevels);
  ipcMain.on("process-print-job", processPrintJob);
  ipcMain.on("toggle-websocket", toggleWebSocket);
   ipcMain.on('update-sound-settings', (_event, settings) => {
        soundSettings = settings;
        log(`Updated sound settings: ${JSON.stringify(settings)}`);
    });
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
  ipcMain.on("check-for-updates", () => {
    autoUpdater.checkForUpdatesAndNotify();
  });
  ipcMain.on("login", handleLogin);
  ipcMain.on("test-login", handleTestLogin);
  ipcMain.on("signup", handleSignup);
  ipcMain.on("sign-out", handleSignOut);
  ipcMain.on("save-kyc-data", handleSaveKycData);

  ipcMain.on("fetch-shop-info", (_event, userEmail) =>{
    console.log("Fetching shop info for:", userEmail) 
    fetchShopInfo(userEmail)
  }
  );
  ipcMain.on("update-shop-info", (_event, updatedInfo) =>
    updateShopInfo(updatedInfo)
  );
  ipcMain.handle('save-temp-file', async (_event, { name, buffer }) => {
    const tempDir = path.join(app.getPath('temp'), 'CtrlP-KYC');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempPath = path.join(tempDir, `${Date.now()}-${name}`);
    await fsPromises.writeFile(tempPath, buffer);
    return tempPath;
});
ipcMain.handle("submit-kyc-data", async (event, kycData) => {
  logKyc("Received submit-kyc-data IPC call", kycData);
  try {
    console.log("Received KYC data:", kycData);

    // Validate required fields
    const requiredFields = [
      "address",
      "aadhaar",
      "pan_card_path",
      "bank_proof_path",
      "passport_photo_path",
    ];
    for (const field of requiredFields) {
      if (!kycData[field]) {
        logKyc(`Missing required field: ${field}`);
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate file paths
    const fileFields = [
      "aadhaar",
      "pan_card_path",
      "bank_proof_path",
      "passport_photo_path",
    ];
    for (const field of fileFields) {
      if (!fs.existsSync(kycData[field])) {
        logKyc(`File not found: ${kycData[field]}`);
        throw new Error(`File not found: ${kycData[field]}`);
      }
    }

    // Fetch shop account
    const { data: shopAccount, error: accountError } = await supabase
      .from("shop_accounts")
      .select("id")
      .eq("email", shopInfo.email)
      .single();

    if (accountError || !shopAccount) {
      logKyc("Shop account error", accountError?.message || "No account found");
      throw new Error("Shop account not found");
    }

    const shopId = shopAccount.id;
    const identifier = `${shopId}-${Date.now()}`;

    // Define bucket mapping
    const docTypes = {
      aadhaar: "aadhar",
      pan_card_path: "pan",
      bank_proof_path: "bank-proof",
      passport_photo_path: "passport-photos",
    };

    const uploadedPaths = {};
    for (const [field, bucket] of Object.entries(docTypes)) {
      const filePath = kycData[field];
      const docType =
        field === "aadhar" ? "aadhaar-front" : field.replace("_path", "");
      const fileName = `${identifier}-${docType}`;
      logKyc(`Uploading document: ${field} to bucket: ${bucket}`);
      uploadedPaths[field] = await uploadDocumentToBucket(
        bucket,
        filePath,
        fileName
      );
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
      kyc_status: "under_review",
      updated_at: new Date().toISOString(),
    };

    logKyc("Updating shop_accounts with KYC payload", kycPayload);

    // Update shop account
    const { error: updateError } = await supabase
      .from("shop_accounts")
      .update(kycPayload)
      .eq("id", shopId);

    if (updateError) {
      logKyc("Error updating KYC data", updateError.message);
      throw updateError;
    }

    logKyc("KYC data submitted successfully");
    return { success: true };
  } catch (error) {
    logKyc("Error submitting KYC data", error.message);
    return { success: false, error: error.message };
  }
});

  // Add to main.js in the setupIpcHandlers function
  ipcMain.handle(
    "update-printer-capabilities",
    async (_event, capabilityChanges) => {
      try {
        // Process each printer's capability changes
        for (const [printerName, changes] of Object.entries(
          capabilityChanges
        )) {
          if (!printerInfo.capabilities[printerName]) {
            log(
              `Warning: Trying to update capabilities for unknown printer: ${printerName}`
            );
            continue;
          }

          // Update job routing rules
          if (changes.capabilities) {
            // Color job routing
            if ("colorJobsOnly" in changes.capabilities) {
              printerInfo.capabilities[printerName].colorJobsOnly =
                changes.capabilities.colorJobsOnly;
            }

            if ("monochromeJobsOnly" in changes.capabilities) {
              printerInfo.capabilities[printerName].monochromeJobsOnly =
                changes.capabilities.monochromeJobsOnly;
            }

            // Duplex job routing
            if ("duplexJobsOnly" in changes.capabilities) {
              printerInfo.capabilities[printerName].duplexJobsOnly =
                changes.capabilities.duplexJobsOnly;
            }

            if ("simplexJobsOnly" in changes.capabilities) {
              printerInfo.capabilities[printerName].simplexJobsOnly =
                changes.capabilities.simplexJobsOnly;
            }
          }

          // Update paper sizes if they've changed
          if (changes.paperSizes && changes.paperSizes.length > 0) {
            // Get the original physical paper sizes
            const physicalPaperSizes = Array.from(
              printerInfo.capabilities[printerName].paperSizes
            );

            // Filter requested paper sizes to only include physically supported ones
            const validPaperSizes = changes.paperSizes.filter((size) =>
              physicalPaperSizes.includes(size)
            );

            // Update the paper sizes
            printerInfo.capabilities[printerName].paperSizes = new Set(
              validPaperSizes
            );

            // Ensure paper levels exist for all supported paper sizes
            validPaperSizes.forEach((size) => {
              if (!printerInfo.paperLevels[printerName][size]) {
                printerInfo.paperLevels[printerName][size] = 0;
              }
            });
          }
        }

        // Save the updated printerInfo
        savePrinterInfo();
        log("Printer capabilities updated successfully");

        // Notify renderer about the updated printer info
        mainWindow.webContents.send("printer-info-updated", {
          printerInfo,
          printerQueues: Object.fromEntries(printerQueues),
        });

        // Update the shop's technical info (supported settings)
        updateShopTechnicalInfo();

        return { success: true };
      } catch (error) {
        log(`Error updating printer capabilities: ${error.message}`);
        return { success: false, error: error.message };
      }
    }
  );
  ipcMain.on("update-printer-capabilities", (_event, capabilityChanges) => {
    try {
      // Process each printer's capability changes
      for (const [printerName, changes] of Object.entries(capabilityChanges)) {
        if (!printerInfo.capabilities[printerName]) {
          log(
            `Warning: Trying to update capabilities for unknown printer: ${printerName}`
          );
          continue;
        }

        // Update basic capabilities
        for (const [capability, value] of Object.entries(
          changes.capabilities
        )) {
          printerInfo.capabilities[printerName][capability] = value;
        }

        // Update paper sizes if they've changed
        if (changes.paperSizes && changes.paperSizes.length > 0) {
          printerInfo.capabilities[printerName].paperSizes = new Set(
            changes.paperSizes
          );

          // Update paper levels for new paper sizes
          changes.paperSizes.forEach((size) => {
            if (!printerInfo.paperLevels[printerName][size]) {
              printerInfo.paperLevels[printerName][size] = 0;
            }
          });

          // Remove paper levels for removed paper sizes
          Object.keys(printerInfo.paperLevels[printerName]).forEach((size) => {
            if (!changes.paperSizes.includes(size)) {
              delete printerInfo.paperLevels[printerName][size];
            }
          });
        }
      }

      // Save the updated printerInfo
      savePrinterInfo();
      log("Printer capabilities updated successfully");

      // Notify renderer about the updated printer info
      mainWindow.webContents.send("printer-info-updated", {
        printerInfo,
        printerQueues: Object.fromEntries(printerQueues),
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
      user: currentUser,
    };
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function initializeLocalPrinterMonitor() {
  if (localPrinterWs) {
    log('Closing existing local printer WebSocket connection');
    localPrinterWs.close();
  }

  log('Attempting to connect to local printer monitor at ws://localhost:8765');
  localPrinterWs = new WebSocket('ws://localhost:8765');

  localPrinterWs.on('open', () => {
    log('Successfully connected to local printer monitor');
    if (localPrinterReconnectTimer) {
      clearInterval(localPrinterReconnectTimer);
      localPrinterReconnectTimer = null;
    }
  });

// Add this to main.js where localPrinterWs.on('message') is handled

// Update the local printer WebSocket message handler
localPrinterWs.on('message', async (data) => {
  log(`Received message from local printer monitor: ${data}`);
  try {
    const message = JSON.parse(data.toString());
    log(`Parsed message: ${JSON.stringify(message)}`);
    
    if (message.type === 'printer_status') {
      // Get list of all connected printers from the message
      const connectedPrinters = message.data.filter(printer => 
        printer.isConnected === true && 
        printer.busAddress !== 'Not Connected' &&
        printer.status !== 3
      ).map(printer => printer.name);

      // Get all printers we're currently tracking (both active and discarded)
      const allTrackedPrinters = [
        ...Object.keys(printerInfo.capabilities),
        ...printerInfo.discardedPrinters
      ];

      // Remove any printer that's not in the connected printers list
      allTrackedPrinters.forEach(printerName => {
        if (!connectedPrinters.includes(printerName)) {
          // Remove from capabilities
          delete printerInfo.capabilities[printerName];
          
          // Remove from paper levels
          delete printerInfo.paperLevels[printerName];
          
          // Remove from printer queues
          printerQueues.delete(printerName);
          
          // Remove from discarded printers
          printerInfo.discardedPrinters = printerInfo.discardedPrinters.filter(
            name => name !== printerName
          );
          
          log(`Completely removed disconnected printer: ${printerName}`);
        }
      });

      // Save changes
      savePrinterInfo();

      // Notify renderer about changes
      mainWindow.webContents.send('printer-info-updated', {
        printerInfo,
        printerQueues: Object.fromEntries(printerQueues)
      });

      // Update shop technical info if needed
      if (currentShopId) {
        updateShopTechnicalInfo();
      }

      log('Updated printer status based on connectivity');
    }
  } catch (error) {
    log(`Error processing printer monitor message: ${error.message}`);
  }
});

  localPrinterWs.on('close', () => {
    log('Disconnected from local printer monitor. Attempting to reconnect...');
    if (!localPrinterReconnectTimer) {
      localPrinterReconnectTimer = setInterval(() => {
        log('Reconnection attempt to local printer monitor');
        initializeLocalPrinterMonitor();
      }, 5000);
    }
  });

  localPrinterWs.on('error', (error) => {
    log(`Local printer monitor error: ${error.message}`);
  });
}

// Update app.whenReady to initialize the local printer monitor
