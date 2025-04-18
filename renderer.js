const { ipcRenderer } = require('electron');

let isConnected = false;
let printerList = [];
let discardedPrinters = [];
let printerQueues = {};
let printerPaperLevels = {};
let metrics = { totalPages: 0, monochromeJobs: 0, colorJobs: 0, totalIncome: 0 };
let jobHistory = [];
let currentView = 'printer';
let currentUser = null;
let dailyMetrics = {};

// Global object to store chart instances
const chartInstances = {};

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed');
    initializeAuthUI();
    setupAuthEventListeners();
    //initializeCarousel();
    setupSettingsDropdown();
    fetchShopInfo();
    loadDailyMetrics();
});

async function fetchShopInfo() {
    try {
        const response = await ipcRenderer.invoke("fetch-shop-info");
        if (response.success) {
            const shopInfo = response.data;
            document.getElementById("shopName").textContent = shopInfo.name;
            document.getElementById("shopOwner").textContent = shopInfo.owner;
            document.getElementById("shopContact").textContent = shopInfo.contact;
            document.getElementById("shopEmail").textContent = shopInfo.email;
            document.getElementById("shopAddress").textContent = shopInfo.address;
            document.getElementById("shopGST").textContent = shopInfo.gst;
        } else {
            console.error("Failed to fetch shop info:", response.error);
        }
    } catch (error) {
        console.error("Error fetching shop info:", error);
    }
}

function initializeAuthUI() {
    if (currentUser) {
        showDashboard();
    } else {
        showAuthView();
    }
}

function setupAuthEventListeners() {
    document.getElementById('loginBtn').addEventListener('click', () => {
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        ipcRenderer.send('login', { email, password });
    });

    document.getElementById('signupBtn').addEventListener('click', () => {
        const email = document.getElementById('signupEmail').value;
        const password = document.getElementById('signupPassword').value;
        ipcRenderer.send('signup', { email, password });
    });

    // Improved test login functionality

    // Only create sign out button if it doesn't exist
    if (!document.getElementById('signOut')) {
        const signOutBtn = document.createElement('button');
        signOutBtn.id = 'signOut';
        signOutBtn.className = 'btn';
        signOutBtn.textContent = 'Sign Out';
        signOutBtn.style.marginTop = '10px';
        const userDropdown = document.querySelector('.user-dropdown');
        if (userDropdown) {
            userDropdown.appendChild(signOutBtn);
            signOutBtn.addEventListener('click', () => {
                ipcRenderer.send('sign-out');
            });
        }
    }
}



function showAuthView() {
    document.getElementById('authView').classList.remove('hidden');
    document.getElementById('dashboardView').classList.add('hidden');
}

function showDashboard() {
    console.log('showDashboard called');
    document.getElementById('authView').classList.add('hidden');
    document.getElementById('dashboardView').classList.remove('hidden');
    initializeUI();
    fetchAndDisplayPrinters();
    setupEventListeners();
    fetchJobHistory();
    loadMetrics();
    loadDailyMetrics();
}

function initializeCarousel() {
    const infoCards = [
        { title: "Welcome to CTRL+P", text: "A powerful print management solution for your business." },
        { title: "Smart Scheduling", text: "Automatically assigns jobs to the best available printer." },
        { title: "Real-time Metrics", text: "Track your printing stats and revenue instantly." },
    ];

    let currentIndex = 0;
    const carousel = document.getElementById('infoCarousel');
    const dotsContainer = document.getElementById('carouselDots');

    function updateCarousel() {

        updateDots();
    }

    function updateDots() {
        dotsContainer.innerHTML = infoCards.map((_, i) => `
            <div class="dot ${i === currentIndex ? 'active' : ''}" onclick="changeCarousel(${i})"></div>
        `).join('');
    }

    window.changeCarousel = (index) => {
        currentIndex = index;
        updateCarousel();
    };

    //updateCarousel();
    setInterval(() => {
        currentIndex = (currentIndex + 1) % infoCards.length;
        //updateCarousel();
    }, 5000);
}

function initializeUI() {
    updateButtonText();
    // renderMetrics();
    renderDailyMetrics();
    
    // Make sure metrics are only visible in printer view
    const metricsSection = document.querySelector('.metrics');
    if (metricsSection && currentView !== 'printer') {
        metricsSection.style.display = 'none';
    }
}

async function loadMetrics() {
    try {
        const response = await ipcRenderer.invoke('get-metrics');
        console.log('Metrics response:', response);
        if (response && typeof response === 'object') {
            metrics = response;
            console.log('Metrics loaded in renderer:', metrics);
            // renderMetrics();
        } else {
            console.error('Invalid metrics response:', response);
            showNotification('Failed to load metrics', 'error');
        }
    } catch (error) {
        console.error('Error loading metrics:', error);
        showNotification('Failed to load metrics', 'error');
    }
}

document.getElementById('checkForUpdates').addEventListener('click', () => {
    ipcRenderer.send('check-for-updates');
  });

async function loadDailyMetrics() {
    try {
        const response = await ipcRenderer.invoke("get-daily-metrics");
        if (response && typeof response === "object") {
            dailyMetrics = response;
            renderDailyMetrics();
            renderEarningsTable();
        } else {
            console.error("Invalid daily metrics response:", response);
            showNotification("Failed to load daily metrics", "error");
        }
    } catch (error) {
        console.error("Error loading daily metrics:", error);
        showNotification("Failed to load daily metrics", "error");
    }
}

function renderDailyMetrics() {
    const today = new Date().toISOString().split("T")[0];
    const todayMetrics = dailyMetrics[today] || {
        totalPages: 0,
        monochromeJobs: 0,
        colorJobs: 0,
        totalIncome: 0,
    };

    document.getElementById("dailyTotalPages").textContent = todayMetrics.totalPages;
    document.getElementById("dailyMonochromeJobs").textContent = todayMetrics.monochromeJobs;
    document.getElementById("dailyColorJobs").textContent = todayMetrics.colorJobs;
    document.getElementById("dailyTotalIncome").textContent = `₹${todayMetrics.totalIncome}`;
}

function renderEarningsTable() {
    const earningsTableBody = document.getElementById("earningsTableBody");
    earningsTableBody.innerHTML = "";

    Object.entries(dailyMetrics).forEach(([date, metrics]) => {
        earningsTableBody.innerHTML += `
            <tr>
                <td>${date}</td>
                <td>${metrics.totalPages}</td>
                <td>${metrics.monochromeJobs}</td>
                <td>${metrics.colorJobs}</td>
                <td>₹${metrics.totalIncome}</td>
            </tr>
        `;
    });
}

// Ensure the table is updated when daily metrics are updated
ipcRenderer.on("daily-metrics-updated", (_event, updatedDailyMetrics) => {
    dailyMetrics = updatedDailyMetrics;
    renderEarningsTable();
});

ipcRenderer.on("daily-metrics-updated", (_event, updatedDailyMetrics) => {
    dailyMetrics = updatedDailyMetrics;
    renderDailyMetrics();
    renderEarningsTable();
});

function updateButtonText() {
    const button = document.getElementById('statusText');
    const toggleSwitch = document.getElementById('toggleWebSocket');
    button.innerHTML = isConnected ? 'ONLINE' : 'OFFLINE';
    button.classList.toggle('connected', isConnected);
    toggleSwitch.checked = isConnected;
}

function switchView(view) {
    currentView = view;
    const views = {
        printer: document.getElementById('printerView'),
        transaction: document.getElementById('transactionView'),
        statistics: document.getElementById('statisticsView'),
        settings: document.getElementById('settingsView')
    };

    // Hide the top header when not on the dashboard
    const topHeader = document.querySelector('.header');
    if (topHeader) {
        topHeader.style.display = view === 'printer' ? 'flex' : 'none';
    }

    // Hide all views first
    Object.values(views).forEach(viewElement => {
        if (viewElement) viewElement.style.display = 'none';
    });

    // Show the selected view
    if (views[view]) {
        views[view].style.display = 'block';

        // If switching to statistics view, render statistics
        if (view === 'statistics') {
            setTimeout(() => renderStatistics(), 100);
        }
    }

    // Update active navigation item
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const activeNavItem = document.getElementById(`${view}Nav`);
    if (activeNavItem) activeNavItem.classList.add('active');
    
    if (view === 'settings') {
        document.getElementById('kycReminder')?.classList.add('hidden-on-settings');
    } else {
        document.getElementById('kycReminder')?.classList.remove('hidden-on-settings');
    }
}

function setupSettingsDropdown() {
    const settingsButton = document.getElementById('settingsNav');
    const settingsDropdown = document.getElementById('settingsDropdown');

    if (!settingsButton || !settingsDropdown) {
        console.error('Settings button or dropdown not found in the DOM');
        return;
    }

    settingsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsDropdown.classList.toggle('hidden');
        
        // Set display style explicitly when showing/hiding
        if (!settingsDropdown.classList.contains('hidden')) {
            settingsDropdown.style.display = 'flex';
            
            // Position the dropdown properly relative to the settings button
            const rect = settingsButton.getBoundingClientRect();
            const sidebarRect = document.querySelector('.sidebar').getBoundingClientRect();
            
            // Position to the right of the sidebar
            settingsDropdown.style.position = 'fixed';
            settingsDropdown.style.top = `${rect.top}px`;
            settingsDropdown.style.left = `${sidebarRect.right + 5}px`;
            settingsDropdown.style.zIndex = '1000';
            
            // Simple animation
            settingsDropdown.style.opacity = '0';
            settingsDropdown.style.transform = 'translateX(-10px)';
            setTimeout(() => {
                settingsDropdown.style.opacity = '1';
                settingsDropdown.style.transform = 'translateX(0)';
            }, 10);
        } else {
            setTimeout(() => {
                settingsDropdown.style.display = 'none';
            }, 200);
            settingsDropdown.style.opacity = '0';
            settingsDropdown.style.transform = 'translateX(-10px)';
        }
    });

    // Close the dropdown when clicking elsewhere
    document.addEventListener('click', (e) => {
        if (!settingsButton.contains(e.target) && !settingsDropdown.contains(e.target)) {
            settingsDropdown.classList.add('hidden');
            setTimeout(() => {
                if (settingsDropdown.classList.contains('hidden')) {
                    settingsDropdown.style.display = 'none';
                }
            }, 200);
            settingsDropdown.style.opacity = '0';
            settingsDropdown.style.transform = 'translateX(-10px)';
        }
    });

    // Set up click event listeners for dropdown items
    document.querySelectorAll('.settings-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            const tabId = item.getAttribute('data-tab');
            
            // Switch to settings view
            switchView('settings');
            
            // Clear any currently active settings tabs
            document.querySelectorAll('.settings-tab').forEach(tab => tab.classList.remove('active'));
            
            // Activate the selected tab
            const tabElement = document.getElementById(tabId);
            if (tabElement) {
                tabElement.classList.add('active');
            } else {
                console.error(`Tab element with ID ${tabId} not found`);
            }
            
            // Hide the dropdown after selection
            settingsDropdown.classList.add('hidden');
            settingsDropdown.style.display = 'none';
        });
    });
    
    // Add CSS transition properties
    settingsDropdown.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
}

function setupEventListeners() {
    document.getElementById('toggleWebSocket').addEventListener('click', toggleWebSocket);
    document.getElementById('dashboardNav').addEventListener('click', () => switchView('printer'));
    document.getElementById('transactionNav').addEventListener('click', () => { switchView('transaction'); filterTransactions(); });
    document.getElementById('statisticsNav').addEventListener('click', () => switchView('statistics'));
    document.getElementById('settingsNav').addEventListener('click', () => switchView('settings'));
    document.getElementById('filterButton').addEventListener('click', filterTransactions);

    // Settings top navigation functionality
    const settingsNavButtons = document.querySelectorAll('.settings-nav-button');
    if (settingsNavButtons.length > 0) {
        settingsNavButtons.forEach(button => {
            button.addEventListener('click', () => {
                // Deactivate all buttons
                settingsNavButtons.forEach(btn => btn.classList.remove('active'));
                // Activate clicked button
                button.classList.add('active');
                
                // Hide all sections
                document.querySelectorAll('.settings-section').forEach(section => {
                    section.classList.remove('active');
                });
                
                // Show selected section
                const sectionId = button.getAttribute('data-section') + 'Section';
                const section = document.getElementById(sectionId);
                if (section) section.classList.add('active');
                
                // Make the first tab in this section active
                const firstTabButton = section.querySelector('.settings-section-button');
                if (firstTabButton) {
                    section.querySelectorAll('.settings-section-button').forEach(btn => {
                        btn.classList.remove('active');
                    });
                    firstTabButton.classList.add('active');
                    
                    const firstTabId = firstTabButton.getAttribute('data-tab');
                    section.querySelectorAll('.settings-tab').forEach(tab => {
                        tab.classList.remove('active');
                    });
                    document.getElementById(firstTabId).classList.add('active');
                }
            });
        });
    }

    // Settings section tab navigation
    const settingsSectionButtons = document.querySelectorAll('.settings-section-button');
    if (settingsSectionButtons.length > 0) {
        settingsSectionButtons.forEach(button => {
            button.addEventListener('click', () => {
                // Find the parent section
                const section = button.closest('.settings-section');
                
                // Deactivate all buttons in this section
                section.querySelectorAll('.settings-section-button').forEach(btn => {
                    btn.classList.remove('active');
                });
                
                // Activate clicked button
                button.classList.add('active');
                
                // Hide all tabs in this section
                section.querySelectorAll('.settings-tab').forEach(tab => {
                    tab.classList.remove('active');
                });
                
                // Show selected tab
                const tabId = button.getAttribute('data-tab');
                const tab = document.getElementById(tabId);
                if (tab) tab.classList.add('active');
            });
        });
    }

    // Remove old event listeners for settings dropdown
    const oldSettingsDropdown = document.getElementById('settingsDropdown');
    if (oldSettingsDropdown) {
        oldSettingsDropdown.remove(); // Remove the dropdown entirely
    }

    // Settings main sections expansion (keeping this for backwards compatibility)
    document.querySelectorAll('.settings-main-header').forEach(header => {
        header.addEventListener('click', () => {
            const mainItem = header.closest('.settings-main-item');
            mainItem.classList.toggle('expanded');
            
            // Close other sections when opening one
            if (mainItem.classList.contains('expanded')) {
                document.querySelectorAll('.settings-main-item').forEach(item => {
                    if (item !== mainItem) {
                        item.classList.remove('expanded');
                    }
                });
            }
        });
    });

    // KYC modal overlay handling
    document.getElementById('kycStatusBtn')?.addEventListener('click', () => {
        const kycOverlayModal = document.getElementById('kycOverlayModal');
        kycOverlayModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // Prevent scrolling of background
    });

    // Close KYC modal buttons
    document.querySelectorAll('.close-kyc-modal, .close-kyc-modal-btn').forEach(button => {
        button.addEventListener('click', () => {
            document.getElementById('kycOverlayModal').classList.add('hidden');
            document.body.style.overflow = ''; // Restore scrolling
        });
    });

    // Submit KYC from overlay modal
    document.getElementById('submitKycOverlayBtn')?.addEventListener('click', submitKycFormFromOverlay);
    
    // View KYC details button
    document.getElementById('viewKycDetailsBtn')?.addEventListener('click', () => {
        // You could either open the KYC modal in read-only mode or navigate to a details page
        document.getElementById('kycOverlayModal').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    });
    
    // Update KYC button
    document.getElementById('updateKycBtn')?.addEventListener('click', () => {
        document.getElementById('kycOverlayModal').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    });

    // Shop info modal
    document.getElementById('editShopInfoBtn')?.addEventListener('click', () => {
        document.getElementById('editShopInfoModal').classList.remove('hidden');
    });

    // Modal close buttons
    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            if (modal) modal.classList.add('hidden');
        });
    });

    // Save shop info button
    //document.getElementById('saveShopInfoBtn')?.addEventListener('click', saveShopInfo);

    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-paper-btn')) {
            const [printerName, paperSize, amount] = e.target.dataset.info.split('|');
            addPages(printerName, paperSize, parseInt(amount));
        } else if (e.target.classList.contains('discard-printer-btn')) {
            discardPrinter(e.target.dataset.printer);
        } else if (e.target.classList.contains('restore-printer-btn')) {
            restorePrinter(e.target.dataset.printer);
        }
    });

    // Document upload handling for all upload areas
    //setupDocumentUploads();
}

// Function to handle KYC form submission from the overlay modal
// renderer.js
async function submitKycFormFromOverlay() {
    try {
        const requiredDocTypes = ['passport-photo', 'aadhaar-front', 'pan-card', 'bank-proof'];
        const kycData = {
            owner_name: document.getElementById('kycFullName').value,
            address: document.getElementById('kycAddress').value,
            state: document.getElementById('kycState').value,
            account_holder_name: document.getElementById('kycAccountHolderName').value,
            account_number: document.getElementById('kycAccountNumber').value,
            ifsc_code: document.getElementById('kycIfscCode').value,
            bank_name: document.getElementById('kycBankName').value,
            branch_name : document.getElementById('kycBranchName').value,

        };

        // Validate and collect document paths
        for (const docType of requiredDocTypes) {
            const previewContainer = document.getElementById(`${docType}Preview`);
            const documentItem = previewContainer?.querySelector('.document-item');
            if (!documentItem || !documentItem.dataset.file) {
                console.error(`Missing document for ${docType}`);
                showNotification(`Please upload ${docType.replace('-', ' ')}`, 'error');
                return;
            }
            // Map document types to kycData keys
            if (docType === 'aadhaar-front') {
                kycData.aadhaar = documentItem.dataset.file;
            } else if (docType === 'pan-card') {
                kycData.pan_card_path = documentItem.dataset.file;
            } else if (docType === 'bank-proof') {
                kycData.bank_proof_path = documentItem.dataset.file;
            } else if (docType === 'passport-photo') {
                kycData.passport_photo_path = documentItem.dataset.file;
            }
            console.log(`Attached ${docType}: ${documentItem.dataset.file}`);
        }

        // Validate required fields
        if (!kycData.owner_name || !kycData.address) {
            showNotification('Please fill in shop name and address', 'error');
            return;
        }

        console.log('Submitting KYC data:', kycData);
        const response = await ipcRenderer.invoke('submit-kyc-data', kycData);
        if (response.success) {
            showNotification('KYC submitted successfully. Verification in progress.', 'success');
            console.log('KYC submission successful:', response);
            // Close the modal
            document.getElementById('kycOverlayModal').classList.add('hidden');
            document.body.style.overflow = '';
            // Switch to KYC status tab
            switchToKycStatusTab();
        } else {
            console.error('KYC submission failed:', response.error);
            showNotification(`Failed to submit KYC: ${response.error}`, 'error');
        }
    } catch (error) {
        console.error('Error submitting KYC:', error);
        showNotification(`Error submitting KYC: ${error.message}`, 'error');
    }
}

// Helper function to switch to KYC Status tab
function switchToKycStatusTab() {
    // First make sure settings view is active
    switchView('settings');
    
    // Activate the KYC button in the top nav
    document.querySelectorAll('.settings-nav-button').forEach(btn => btn.classList.remove('active'));
    const kycButton = document.querySelector('.settings-nav-button[data-section="kyc"]');
    if (kycButton) kycButton.classList.add('active');
    
    // Show the KYC section
    document.querySelectorAll('.settings-section').forEach(section => section.classList.remove('active'));
    const kycSection = document.getElementById('kycSection');
    if (kycSection) kycSection.classList.add('active');
    
    // Activate the KYC Status tab
    const kycSectionButtons = kycSection.querySelectorAll('.settings-section-button');
    kycSectionButtons.forEach(btn => btn.classList.remove('active'));
    const kycStatusButton = kycSection.querySelector('.settings-section-button[data-tab="kycStatusTab"]');
    if (kycStatusButton) kycStatusButton.classList.add('active');
    
    // Show the KYC Status content
    kycSection.querySelectorAll('.settings-tab').forEach(tab => tab.classList.remove('active'));
    document.getElementById('kycStatusTab').classList.add('active');
}

// Close any open KYC modal when clicking outside of it
document.addEventListener('click', (e) => {
    const kycModal = document.getElementById('kycOverlayModal');
    const kycContent = document.querySelector('.kyc-modal-content');
    
    if (kycModal && !kycModal.classList.contains('hidden') && 
        e.target === kycModal && !kycContent.contains(e.target)) {
        kycModal.classList.add('hidden');
        document.body.style.overflow = ''; // Restore scrolling
    }
})

async function fetchAndDisplayPrinters() {
    try {
        const { printers, printerInfo, printerQueues: queues } = await ipcRenderer.invoke('get-printers');
        printerList = printers;
        discardedPrinters = printerInfo.discardedPrinters || [];
        printerPaperLevels = printerInfo.paperLevels || {};
        printerQueues = queues;

        if (printerList.length === 0) {
            showNotification('No physical printers found.', 'warning');
            document.getElementById('printersContainer').innerHTML = `
                <div class="no-printers-message">
                    <h3>No Physical Printers Found</h3>
                    <p>Please ensure that:</p>
                    <ul>
                        <li>Your printer is properly connected</li>
                        <li>Printer drivers are installed</li>
                        <li>The printer is turned on</li>
                    </ul>
                </div>
            `;
        } else {
            renderPrinters();
            updateDiscardedPrinters(); // Make sure this is called after rendering printers
            checkAndUpdatePrinterStatus();
        }
    } catch (error) {
        console.error(`Error fetching printers: ${error}`);
        showNotification('Failed to fetch printers', 'error');
    }
}

function renderPrinters() {
    const printersContainer = document.getElementById('printersContainer');
    printersContainer.innerHTML = '';

    printerList.forEach(printer => {
        if (!discardedPrinters.includes(printer.name)) {
            const printerCard = createPrinterCard(printer);
            printersContainer.appendChild(printerCard);
            updatePrinterQueue(printer.name);
        }
    });
}

function createPrinterCard(printer) {
    const printerCard = document.createElement('div');
    printerCard.classList.add('printer-card');
    const caps = printer.capabilities;

    printerCard.innerHTML = `
        <div class="printer-header">
            <h2>${printer.name}</h2>
            <span>Color: ${caps.color ? 'Yes' : 'No'}, Duplex: ${caps.duplex ? 'Yes' : 'No'}</span>
            <button class="discard-printer-btn" data-printer="${printer.name}">
                <i class="fas fa-trash"></i> Discard
            </button>
        </div>
        <div class="paper-levels">
            ${Array.from(caps.paperSizes).map(size => `
                <div class="paper-level">
                    <span>${size}: <span id="${printer.name}-${size}">${printerPaperLevels[printer.name]?.[size] || 0}</span> pages</span>
                    <div class="paper-level-buttons">
                        <button class="add-paper-btn" data-info="${printer.name}|${size}|100">+100</button>
                        <button class="add-paper-btn" data-info="${printer.name}|${size}|500">+500</button>
                    </div>
                </div>
            `).join('')}
        </div>
        <div class="job-list" id="job-list-${printer.name}">
            <div class="job-item">No jobs in queue</div>
        </div>
    `;
    
    // Add direct event listeners for the buttons
    const discardButton = printerCard.querySelector('.discard-printer-btn');
    if (discardButton) {
        discardButton.addEventListener('click', () => {
            discardPrinter(printer.name);
        });
    }
    
    const addPaperButtons = printerCard.querySelectorAll('.add-paper-btn');
    addPaperButtons.forEach(button => {
        button.addEventListener('click', () => {
            const [printerName, paperSize, amount] = button.getAttribute('data-info').split('|');
            addPages(printerName, paperSize, parseInt(amount));
        });
    });

    return printerCard;
}

function updatePrinterQueue(printerName) {
    const jobList = document.getElementById(`job-list-${printerName}`);
    if (!jobList) return;

    const queue = printerQueues[printerName] || [];
    jobList.innerHTML = queue.length === 0 
        ? '<div class="job-item">No jobs in queue</div>'
        : queue.map(job => `
            <div class="job-item ${job.print_status}">
                <span>Job ${job.job_id} - ${job.number_of_pages} pages (${job.color_mode})</span>
                <span class="job-status">${job.print_status}</span>
            </div>
        `).join('');
}

function discardPrinter(printerName) {
    if (!discardedPrinters.includes(printerName)) {
        discardedPrinters.push(printerName);
        ipcRenderer.send('update-discarded-printers', discardedPrinters);
        renderPrinters();
        updateDiscardedPrinters();
        showNotification(`Printer ${printerName} discarded`, 'warning');
    }
}

function restorePrinter(printerName) {
    console.log(`Attempting to restore printer: ${printerName}`);
    discardedPrinters = discardedPrinters.filter(name => name !== printerName);
    ipcRenderer.send('update-discarded-printers', discardedPrinters);
    renderPrinters();
    updateDiscardedPrinters();
    showNotification(`Printer ${printerName} restored`, 'success');
}

function updateDiscardedPrinters() {
    const discardedPrintersContainer = document.getElementById('discardedPrinters');
    const discardedPrintersList = document.getElementById('discardedPrintersList');
    
    // Clear existing content
    if (discardedPrintersList) {
        discardedPrintersList.innerHTML = '';
    }

    if (discardedPrinters.length > 0) {
        discardedPrinters.forEach(printerName => {
            const button = document.createElement('button');
            button.classList.add('restore-printer-btn');
            button.setAttribute('data-printer', printerName);
            button.innerHTML = `<i class="fas fa-undo"></i> Restore ${printerName}`;
            
            // Add direct event listener here for better reliability
            button.addEventListener('click', () => {
                restorePrinter(printerName);
            });
            
            if (discardedPrintersList) {
                discardedPrintersList.appendChild(button);
            }
        });
        
        // Show the container if there are discarded printers
        discardedPrintersContainer.classList.remove('hidden');
    } else {
        // Hide the container if there are no discarded printers
        discardedPrintersContainer.classList.add('hidden');
    }
}

function checkAndUpdatePrinterStatus() {
    let allPrintersLow = true;
    printerList.forEach(printer => {
        const paperLevels = printerPaperLevels[printer.name];
        if (paperLevels) {
            const allLevelsLow = Object.values(paperLevels).every(level => level < 10);
            if (allLevelsLow && !discardedPrinters.includes(printer.name)) {
                discardPrinter(printer.name);
            }
            if (!allLevelsLow) allPrintersLow = false;
        }
    });

    if (allPrintersLow && isConnected) {
        toggleWebSocket();
        showNotification('All printers have low paper levels. WebSocket disconnected.', 'warning');
    }
}

async function fetchJobHistory() {
    try {
        console.log('Fetching job history...');
        const response = await ipcRenderer.invoke('get-job-history');
        console.log('Job history response:', response);
        if (response && Array.isArray(response)) {
            jobHistory = response;
            if (currentView === 'transaction') {
                // Set default date ranges and apply filter immediately
                setDefaultDateFilters();
                filterTransactions();
            } else if (currentView === 'statistics') {
                renderStatistics();
            }
        } else {
            console.error('Invalid job history response:', response);
            showNotification('Failed to fetch job history', 'error');
        }
    } catch (error) {
        console.error('Error fetching job history:', error);
        showNotification('Failed to fetch job history', 'error');
    }
}

function setDefaultDateFilters() {
    // Set end date to today
    const endDate = new Date();
    // Set start date to yesterday
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 1);
    
    // Format dates as YYYY-MM-DD for input fields
    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    
    // Set input field values
    document.getElementById('startDate').value = formatDate(startDate);
    document.getElementById('endDate').value = formatDate(endDate);
}

function renderTransactionTable(transactions) {
    const tableBody = document.getElementById('transactionTableBody');
    if (!transactions || transactions.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="no-data">No transactions found for the selected date range.</td></tr>`;
        return;
    }
    
    tableBody.innerHTML = transactions.map(job => `
        <tr>
            <td>${job.job_id}</td>
            <td>${new Date(job.processed_timestamp).toLocaleString()}</td>
            <td>${job.file_path || job.file_name || 'N/A'}</td>
            <td>${job.assigned_printer || 'N/A'}</td>
            <td>${job.total_pages || job.number_of_pages * job.copies || 'N/A'}</td>
            <td>${job.color_mode}</td>
            <td>${job.print_status}</td>
        </tr>
    `).join('');
}

function filterTransactions() {
    const startDate = new Date(document.getElementById('startDate').value);
    const endDate = new Date(document.getElementById('endDate').value);
    endDate.setHours(23, 59, 59, 999);
    
    const filteredJobs = jobHistory.filter(job => {
        const jobDate = new Date(job.processed_timestamp);
        return (!isNaN(startDate) && !isNaN(endDate)) && 
               jobDate >= startDate && 
               jobDate <= endDate;
    });
    console.log('Filtered jobs:', filteredJobs);

    renderTransactionTable(filteredJobs);
}

// Ensure Chart.js is loaded before rendering statistics
async function ensureChartJsLoaded() {
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js not found, attempting to load dynamically...');
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js'; // Use a CDN to load Chart.js
        script.onload = () => console.log('Chart.js loaded successfully');
        script.onerror = () => console.error('Failed to load Chart.js');
        document.head.appendChild(script);

        // Wait for the script to load
        await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = reject;
        });
    }
}

// Update renderStatistics to ensure Chart.js is loaded
async function renderStatistics() {
    const statsContainer = document.getElementById('statisticsView');
    if (!statsContainer) {
        console.error('Statistics container not found');
        return;
    }

    try {
        await ensureChartJsLoaded(); // Ensure Chart.js is loaded

        // Clear existing charts before rendering
        document.querySelectorAll('.stats-card canvas').forEach(canvas => {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        });

        renderJobsPerDayChart(jobHistory || []);
        renderJobTypeDistributionChart(jobHistory || []);
        renderPaperSizeDistributionChart(jobHistory || []);
        renderPrinterUsageChart(jobHistory || []);
        renderColorVsMonochromeChart(jobHistory || []);
        renderDailyJobsChart(jobHistory || []);
        renderVolumeStats(jobHistory || []);
        renderEfficiencyStats(jobHistory || []);

        // Resize charts to fit containers properly
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 100);
    } catch (error) {
        console.error('Error rendering statistics:', error);
        showNotification('Statistics unavailable: Failed to load Chart.js', 'error');
    }
}

function renderJobsPerDayChart(jobs) {
    const ctx = document.getElementById('jobsPerDayChart').getContext('2d');

    // Destroy existing chart instance if it exists
    if (chartInstances.jobsPerDayChart) {
        chartInstances.jobsPerDayChart.destroy();
    }

    const jobsByDay = jobs.reduce((acc, job) => {
        const date = new Date(job.processed_timestamp).toLocaleDateString();
        acc[date] = (acc[date] || 0) + 1;
        return acc;
    }, {});

    chartInstances.jobsPerDayChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Object.keys(jobsByDay),
            datasets: [{
                label: 'Jobs per Day',
                data: Object.values(jobsByDay),
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            plugins: { title: { display: true, text: 'Jobs per Day' } }
        }
    });
}

function renderJobTypeDistributionChart(jobs) {
    const ctx = document.getElementById('jobTypeDistributionChart').getContext('2d');

    // Destroy existing chart instance if it exists
    if (chartInstances.jobTypeDistributionChart) {
        chartInstances.jobTypeDistributionChart.destroy();
    }

    const jobTypes = jobs.reduce((acc, job) => {
        acc[job.color_mode] = (acc[job.color_mode] || 0) + 1;
        return acc;
    }, {});

    chartInstances.jobTypeDistributionChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(jobTypes),
            datasets: [{ data: Object.values(jobTypes), backgroundColor: ['rgb(255, 99, 132)', 'rgb(54, 162, 235)'] }]
        },
        options: {
            responsive: true,
            plugins: { title: { display: true, text: 'Job Type Distribution' } }
        }
    });
}

function renderPaperSizeDistributionChart(jobs) {
    const ctx = document.getElementById('paperSizeDistributionChart').getContext('2d');

    // Destroy existing chart instance if it exists
    if (chartInstances.paperSizeDistributionChart) {
        chartInstances.paperSizeDistributionChart.destroy();
    }

    const paperSizes = jobs.reduce((acc, job) => {
        acc[job.paper_size] = (acc[job.paper_size] || 0) + 1;
        return acc;
    }, {});

    chartInstances.paperSizeDistributionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(paperSizes),
            datasets: [{ label: 'Number of Jobs', data: Object.values(paperSizes), backgroundColor: 'rgb(75, 192, 192)' }]
        },
        options: {
            responsive: true,
            plugins: { title: { display: true, text: 'Paper Size Distribution' } }
        }
    });
}

function renderPrinterUsageChart(jobs) {
    const ctx = document.getElementById('printerUsageChart').getContext('2d');

    // Destroy existing chart instance if it exists
    if (chartInstances.printerUsageChart) {
        chartInstances.printerUsageChart.destroy();
    }

    const printerUsage = jobs.reduce((acc, job) => {
        const printer = job.assigned_printer || 'Unassigned';
        acc[printer] = (acc[printer] || 0) + 1;
        return acc;
    }, {});

    chartInstances.printerUsageChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(printerUsage),
            datasets: [{
                data: Object.values(printerUsage),
                backgroundColor: ['rgb(255, 99, 132)', 'rgb(54, 162, 235)', 'rgb(255, 205, 86)', 'rgb(75, 192, 192)', 'rgb(153, 102, 255)']
            }]
        },
        options: {
            responsive: true,
            plugins: { title: { display: true, text: 'Printer Usage Distribution' } }
        }
    });
}

function renderColorVsMonochromeChart(jobs) {
    const ctx = document.getElementById('colorVsMonochromeChart').getContext('2d');

    // Destroy existing chart instance if it exists
    if (chartInstances.colorVsMonochromeChart) {
        chartInstances.colorVsMonochromeChart.destroy();
    }

    const colorJobs = jobs.filter(job => job.color_mode.toLowerCase() === 'color').length;
    const monoJobs = jobs.filter(job => job.color_mode.toLowerCase() === 'monochrome').length;

    chartInstances.colorVsMonochromeChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['Color', 'Monochrome'],
            datasets: [{ data: [colorJobs, monoJobs], backgroundColor: ['rgb(255, 99, 132)', 'rgb(54, 162, 235)'] }]
        },
        options: {
            responsive: true,
            plugins: { title: { display: true, text: 'Color vs Monochrome Jobs' } }
        }
    });
}

function renderDailyJobsChart(jobs) {
    const ctx = document.getElementById('dailyJobsChart').getContext('2d');

    // Destroy existing chart instance if it exists
    if (chartInstances.dailyJobsChart) {
        chartInstances.dailyJobsChart.destroy();
    }

    const dailyJobs = jobs.reduce((acc, job) => {
        const date = new Date(job.processed_timestamp).toLocaleDateString();
        acc[date] = (acc[date] || 0) + (job.total_pages || job.number_of_pages * job.copies);
        return acc;
    }, {});

    chartInstances.dailyJobsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(dailyJobs),
            datasets: [{ label: 'Pages Printed', data: Object.values(dailyJobs), backgroundColor: 'rgb(75, 192, 192)' }]
        },
        options: {
            responsive: true,
            plugins: { title: { display: true, text: 'Daily Pages Printed' } }
        }
    });
}

function renderVolumeStats(jobs) {
    const volumeStats = document.getElementById('volumeStats');
    if (!volumeStats) {
        console.error('Volume stats container not found');
        return;
    }

    // Calculate total pages printed
    const totalPages = jobs.reduce((acc, job) => acc + (job.total_pages || job.number_of_pages * job.copies || 0), 0);
    
    // Calculate average pages per job
    const avgPagesPerJob = jobs.length ? (totalPages / jobs.length).toFixed(2) : 0;
    
    // Find the job with maximum pages
    const maxPagesJob = jobs.reduce((max, job) => 
        Math.max(max, job.total_pages || job.number_of_pages * job.copies || 0), 0);

    // Update the volume stats container with the calculated values
    volumeStats.innerHTML = `
        <p>Total Pages Printed: <span>${totalPages}</span></p>
        <p>Average Pages per Job: <span>${avgPagesPerJob}</span></p>
        <p>Max Pages in a Job: <span>${maxPagesJob}</span></p>
    `;
}

function renderEfficiencyStats(jobs) {
    const efficiencyStats = document.getElementById('efficiencyStats');
    if (!efficiencyStats) {
        console.error('Efficiency stats container not found');
        return;
    }

    // Calculate completed and failed jobs
    const completedJobs = jobs.filter(job => job.print_status === 'completed').length;
    const failedJobs = jobs.filter(job => job.print_status === 'failed').length;
    
    // Calculate success rate percentage
    const successRate = jobs.length ? ((completedJobs / jobs.length) * 100).toFixed(2) : 0;

    // Update the efficiency stats container with the calculated values
    efficiencyStats.innerHTML = `
        <p>Total Jobs: <span>${jobs.length}</span></p>
        <p>Completed Jobs: <span>${completedJobs}</span></p>
        <p>Failed Jobs: <span>${failedJobs}</span></p>
        <p>Success Rate: <span>${successRate}%</span></p>
    `;
}



function toggleWebSocket() {
    const toggleSwitch = document.getElementById('toggleWebSocket');
    isConnected = toggleSwitch.checked;
    ipcRenderer.send('toggle-websocket', isConnected);
    updateButtonText();
}

function addPages(printerName, paperSize, amount) {
    if (!printerPaperLevels[printerName]) printerPaperLevels[printerName] = {};
    printerPaperLevels[printerName][paperSize] = (printerPaperLevels[printerName][paperSize] || 0) + amount;
    document.getElementById(`${printerName}-${paperSize}`).textContent = printerPaperLevels[printerName][paperSize];
    ipcRenderer.send('update-printer-paper-levels', { printerName, levels: printerPaperLevels[printerName] });
    showNotification(`Added ${amount} pages of ${paperSize} to ${printerName}`, 'success');
}

function renderMetrics() {
    document.getElementById('totalPages').textContent = metrics.totalPages;
    document.getElementById('monochromeJobs').textContent = metrics.monochromeJobs;
    document.getElementById('colorJobs').textContent = metrics.colorJobs;
    document.getElementById('totalIncome').textContent = `₹${metrics.totalIncome}`;
}

function showNotification(message, type) {
    const notificationContainer = document.getElementById('notificationContainer');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;

    let iconClass = '';
    switch (type) {
        case 'success': iconClass = 'fas fa-check-circle'; break;
        case 'error': iconClass = 'fas fa-times-circle'; break;
        case 'warning': iconClass = 'fas fa-exclamation-triangle'; break;
        case 'info': iconClass = 'fas fa-info-circle'; break;
        default: iconClass = 'fas fa-bell';
    }

    notification.innerHTML = `<i class="${iconClass}"></i><span>${message}</span>`;
    notificationContainer.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 500);
    }, 3000);
}

ipcRenderer.on('update-available', () => {
    showNotification('Update available. Downloading...', 'info');
  });
  
  ipcRenderer.on('update-downloaded', () => {
    showNotification('Update downloaded. Restarting to install...', 'success');
  });
  
  ipcRenderer.on('update-error', (_event, error) => {
    showNotification(`Update error: ${error}`, 'error');
  });

ipcRenderer.on('websocket-status', (_event, status) => {
    isConnected = status === 'connected';
    updateButtonText();
});

ipcRenderer.on('force-toggle-websocket', (_event, connect) => {
    isConnected = connect;
    updateButtonText();
});

ipcRenderer.on('all-printers-discarded', () => {
    showNotification('All printers are discarded. WebSocket connection disabled.', 'warning');
});

ipcRenderer.on('print-job', (_event, job) => {
    showNotification(`New job received: ${job.job_id}`, 'info');
    fetchAndDisplayPrinters();
});

ipcRenderer.on('print-complete', (_event, jobId) => {
    showNotification(`Job ${jobId} completed successfully`, 'success');
    fetchJobHistory();
    fetchAndDisplayPrinters();
});

ipcRenderer.on('print-failed', (_event, jobId) => {
    showNotification(`Job ${jobId} failed`, 'error');
    fetchJobHistory();
    fetchAndDisplayPrinters();
});

ipcRenderer.on('metrics-updated', (_event, updatedMetrics) => {
    metrics = updatedMetrics;
    // renderMetrics();
});

ipcRenderer.on('job-history-updated', () => {
    fetchJobHistory();
});

ipcRenderer.on('printer-queues-updated', (_event, queues) => {
    printerQueues = queues;
    printerList.forEach(printer => updatePrinterQueue(printer.name));
});

ipcRenderer.on('printer-info-updated', (_event, { printerInfo, printerQueues: queues }) => {
    printerPaperLevels = printerInfo.paperLevels;
    discardedPrinters = printerInfo.discardedPrinters;
    printerQueues = queues;
    renderPrinters();
    updateDiscardedPrinters();
});

ipcRenderer.on('log-message', (_event, message) => {
    console.log(message);
});

ipcRenderer.on('auth-success', (_event, user) => {
    console.log('Auth success received:', user);
    currentUser = user;

    // Special handling for test user
    if (user.isTestUser) {
        console.log('Test user login detected');
    }

    // Make sure to reset any login form UIs
    const testLoginButton = document.getElementById('testLoginBtn');
    if (testLoginButton && testLoginButton.classList.contains('loading')) {
        testLoginButton.classList.remove('loading');
    }

    console.log('About to show dashboard');
    showDashboard();
    console.log('Dashboard should be visible now');

    showNotification(`Welcome, ${user.email || 'Test User'}!`, 'success');

    // Update user information in the dashboard
    const userNameEl = document.querySelector('.user-name');
    const userEmailEl = document.querySelector('.user-email');

    if (userNameEl) userNameEl.textContent = user.email ? user.email.split('@')[0] : 'Test User';
    if (userEmailEl) userEmailEl.textContent = user.email || 'test@ctrlp.com';
});

ipcRenderer.on('auth-error', (_event, message) => {
    // Reset loading states on error
    const testLoginButton = document.getElementById('testLoginBtn');
    if (testLoginButton && testLoginButton.classList.contains('loading')) {
        testLoginButton.classList.remove('loading');
    }
    
    showNotification(`Authentication failed: ${message}`, 'error');
});

ipcRenderer.on('sign-out-success', () => {
    currentUser = null;
    showAuthView();
    showNotification('Signed out successfully', 'info');
});

function displayKycReminder() {
    const kycReminder = document.createElement('div');
    kycReminder.id = 'kycReminder';
    kycReminder.className = 'kyc-reminder';
    kycReminder.innerHTML = `
        <p>
            <i class="fas fa-info-circle"></i> 
            Please complete your KYC or wait for verification if you've already submitted your documents. 
            <a href="#" id="goToSettings">Go to Settings</a>
        </p>
    `;
    document.body.appendChild(kycReminder);

    document.getElementById('goToSettings').addEventListener('click', (e) => {
        e.preventDefault();
        switchView('settings');
    });
}

ipcRenderer.on("kyc-required", () => {
    console.log("KYC required, showing settings view");
    document.getElementById("printerView").classList.add("hidden");
    document.getElementById("transactionView").classList.add("hidden");
    document.getElementById("statisticsView").classList.add("hidden");
    document.getElementById("settingsView").classList.remove("hidden");

    // Show only the Accounts and KYC tabs
    document.querySelectorAll(".settings-nav-button").forEach((button) => {
        const section = button.getAttribute("data-section");
        if (section !== "account" && section !== "kyc") {
            button.classList.add("hidden");
        }
    });

    // Display KYC reminder banner on all pages except settings
    if (!document.getElementById('kycReminder')) {
        displayKycReminder();
    }
});

ipcRenderer.on("kyc-verified", () => {
    document.getElementById("printerView").classList.remove("hidden");
    document.getElementById("transactionView").classList.remove("hidden");
    document.getElementById("statisticsView").classList.remove("hidden");

    // Remove KYC reminder banner if it exists
    const kycReminder = document.getElementById('kycReminder');
    if (kycReminder) {
        kycReminder.remove();
    }
});

ipcRenderer.on("shop-info-fetched", (_event, shopInfo) => {
    document.getElementById("shopName").textContent = shopInfo.shop_name || "Not Provided";
    document.getElementById("shopOwner").textContent = shopInfo.owner_name || "Not Provided";
    document.getElementById("shopContact").textContent = shopInfo.contact_number || "Not Provided";
    document.getElementById("shopEmail").textContent = shopInfo.email || "Not Provided";
    document.getElementById("shopAddress").textContent = shopInfo.address || "Not Provided";
    document.getElementById("shopGST").textContent = shopInfo.gst_number || "Not Provided";

    // Update KYC timeline based on kyc_status
    const kycStatusIndicator = document.querySelector('.kyc-status-indicator');
    const timelineItems = document.querySelectorAll('.timeline-item');
    const timelineDate = document.querySelector('.timeline-date');
    const kycNote = document.querySelector('.kyc-note');
    const updateKycBtn = document.getElementById('updateKycBtn');
    const viewKycDetailsBtn = document.getElementById('viewKycDetailsBtn');

    if (shopInfo.kyc_status && kycStatusIndicator && timelineItems.length > 0) {
        const status = shopInfo.kyc_status.toLowerCase();
        const updatedAt = new Date(shopInfo.updated_at).toLocaleString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        if (status === 'waiting for document upload') {
            kycStatusIndicator.className = 'kyc-status-indicator pending';
            kycStatusIndicator.innerHTML = '<i class="fas fa-upload"></i><span>Waiting for Document Upload</span>';
            timelineItems[0].classList.add('active');
            if (kycNote) kycNote.textContent = "Please upload the required documents to proceed with KYC verification.";
            if (updateKycBtn) updateKycBtn.style.display = 'none';
            if (viewKycDetailsBtn) viewKycDetailsBtn.style.display = 'none';
        } else if (status === 'under_review') {
            kycStatusIndicator.className = 'kyc-status-indicator pending';
            kycStatusIndicator.innerHTML = '<i class="fas fa-clock"></i><span>Under Review</span>';
            timelineItems[0].classList.add('active');
            timelineItems[1].classList.add('active');
            if (kycNote) kycNote.textContent = "Your KYC documents are under review. Please wait for verification.";
            if (updateKycBtn) updateKycBtn.style.display = 'inline-block';
            if (viewKycDetailsBtn) viewKycDetailsBtn.style.display = 'inline-block';
        } else if (status === 'verified') {
            kycStatusIndicator.className = 'kyc-status-indicator approved';
            kycStatusIndicator.innerHTML = '<i class="fas fa-check-circle"></i><span>Verified</span>';
            timelineItems.forEach(item => item.classList.add('active'));
            if (kycNote) kycNote.textContent = "Your KYC has been successfully verified.";
            if (updateKycBtn) updateKycBtn.style.display = 'inline-block';
            if (viewKycDetailsBtn) viewKycDetailsBtn.style.display = 'inline-block';
        }

        if (timelineDate) {
            timelineDate.textContent = updatedAt;
        }
    }
});

ipcRenderer.on("shop-info-updated", (_event, { success, error }) => {
    if (success) {
        alert("Shop information updated successfully!");
        ipcRenderer.send("fetch-shop-info"); // Refresh shop info
    } else {
        alert(`Error updating shop information: ${error}`);
    }
});

document.getElementById("saveShopInfoBtn").addEventListener("click", () => {
    const updatedInfo = {
        name: document.getElementById("shopName").value || null,
        location: document.getElementById("shopLocation").value || null,
        address: document.getElementById("shopAddress").value || null,
        contact_info: document.getElementById("shopContactInfo").value || null,
    };

    ipcRenderer.send("update-shop-info", updatedInfo);
});

ipcRenderer.send("fetch-shop-info"); // Fetch shop info on page load

function navigateToPage(page) {
    ipcRenderer.send('navigate', page);
}

// Add global navigation functions
window.navigateToDashboard = () => navigateToPage('dashboard.html');
window.navigateToTransactions = () => navigateToPage('transactions.html');
window.navigateToStatistics = () => navigateToPage('statistics.html');
window.navigateToSettings = () => navigateToPage('settings.html');

function updateKycButtonState() {
    const requiredDocTypes = ['passport-photo', 'aadhaar-front', 'pan-card', 'bank-proof'];
    const updateKycBtn = document.getElementById('updateKycBtn');
    let allDocsUploaded = true;

    requiredDocTypes.forEach(docType => {
        const previewContainer = document.getElementById(`${docType}Preview`);
        if (!previewContainer || previewContainer.children.length === 0) {
            allDocsUploaded = false;
        }
    });

    updateKycBtn.disabled = !allDocsUploaded;
    updateKycBtn.classList.toggle('inactive', !allDocsUploaded);
}

document.querySelectorAll('.kyc-upload .file-input').forEach(fileInput => {
    fileInput.addEventListener('change', async (event) => {
        const upload = event.target.closest('.kyc-upload');
        const file = event.target.files[0];
        const documentType = upload.getAttribute('data-type');
        const previewContainer = document.getElementById(`${documentType}Preview`);

        if (!file) {
            console.error(`No file selected for ${documentType}`);
            return;
        }

        console.log(`Selected file: ${file.name}, size: ${file.size} bytes`);

        try {
            // Save the file path to the dataset for later use
            const filePath = await saveFileToTemp(file);
            upload.dataset.filePath = filePath;
            console.log(`File path saved for ${documentType}: ${filePath}`); // Debug log

            // Create document preview
            const documentPreview = document.createElement('div');
            documentPreview.className = 'document-item';
            documentPreview.dataset.file = filePath;
            documentPreview.innerHTML = `
                <span class="document-name">${file.name}</span>
                <span class="document-remove"><i class="fas fa-times"></i></span>
            `;

            // Add remove functionality
            documentPreview.querySelector('.document-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                console.log(`Removing file: ${file.name} for document type: ${documentType}`);
                documentPreview.remove();
                fileInput.value = '';
                upload.classList.remove('hidden'); // Show the upload box again
                delete upload.dataset.filePath; // Remove the stored file path
            });

            // Clear previous preview and add new one
            previewContainer.innerHTML = '';
            previewContainer.appendChild(documentPreview);

            // Hide the upload box
            upload.classList.add('hidden');
            console.log(`File successfully attached for document type: ${documentType}`);
        } catch (error) {
            console.error(`Error saving file for ${documentType}:`, error);
        }
    });
});

// Helper function to save the file to a temporary location
async function saveFileToTemp(file) {
    const tempDir = require('os').tmpdir();
    const tempFilePath = `${tempDir}/${file.name}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    require('fs').writeFileSync(tempFilePath, buffer);
    return tempFilePath;
}

// Call this function initially to ensure the button state is correct
updateKycButtonState();