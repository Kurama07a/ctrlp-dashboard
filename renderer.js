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
    setupSettingsDropdown();
    //fetchShopInfo();
    loadDailyMetrics();
    setupSettingsNavigation();
});
// Add to renderer.js
function setupSettingsNavigation() {
    document.querySelectorAll('.settings-nav-button').forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons
            document.querySelectorAll('.settings-nav-button').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Add active class to clicked button
            button.classList.add('active');
            
            // Hide all sections
            document.querySelectorAll('.settings-section').forEach(section => {
                section.classList.remove('active');
            });
            
            // Show selected section
            const sectionId = button.getAttribute('data-section') + 'Section';
            const section = document.getElementById(sectionId);
            if (section) {
                section.classList.add('active');
                
                // Handle tab navigation within the section
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
                    document.getElementById(firstTabId)?.classList.add('active');
                }
            }
        });
    });

    // Handle tab navigation within sections
    document.querySelectorAll('.settings-section-button').forEach(button => {
        button.addEventListener('click', () => {
            const section = button.closest('.settings-section');
            
            // Remove active class from all buttons in this section
            section.querySelectorAll('.settings-section-button').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Add active class to clicked button
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

// Call this function when the page loads

// Add to your renderer.js file
document.getElementById('sendSupportMessage')?.addEventListener('click', () => {
    const message = document.getElementById('supportMessage')?.value.trim();
    if (!message) {
        showNotification('Please enter a message before sending', 'warning');
        return;
    }

    // Replace with your support phone number
    const phoneNumber = '918299064687'; // Format: country code + phone number
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${phoneNumber}&text=${encodedMessage}`;
    
    // Open in default browser
    require('electron').shell.openExternal(whatsappUrl);
    
    // Clear the textarea
    if (document.getElementById('supportMessage')) {
        document.getElementById('supportMessage').value = '';
    }
    
    showNotification('Opening WhatsApp...', 'success');
});

async function fetchShopInfo() {
    try {
        //const response = await ipcRenderer.invoke("fetch-shop-info");
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
// Add this function to renderer.js
// Add this function to renderer.js
function toggleMetricsVisibility() {
    const metricsSection = document.getElementById('metricsSection');
    const toggleBtn = document.getElementById('toggleMetrics');
    const metricValues = metricsSection.querySelectorAll('.metric-value');
    const icon = toggleBtn.querySelector('i');
    
    // Store the original values if not already stored
    metricValues.forEach(value => {
        if (!value.dataset.originalValue) {
            value.dataset.originalValue = value.textContent;
        }
    });
    
    const isHidden = icon.classList.contains('fa-eye-slash');
    
    if (isHidden) {
        // Show the values
        metricValues.forEach(value => {
            value.textContent = value.dataset.originalValue;
        });
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    } else {
        // Hide the values with asterisks
        metricValues.forEach(value => {
            value.textContent = '*'.repeat(value.dataset.originalValue.length);
        });
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    }
    
    // Save preference
    localStorage.setItem('metricsHidden', !isHidden);
}

// Update the existing event listener for the toggle button
document.getElementById('toggleMetrics').addEventListener('click', toggleMetricsVisibility);

// Update initializeMetricsVisibility to use the new toggle function
function initializeMetricsVisibility() {
    const isHidden = localStorage.getItem('metricsHidden') === 'true';
    const toggleBtn = document.getElementById('toggleMetrics');
    const icon = toggleBtn.querySelector('i');
    
    if (isHidden) {
        const metricValues = document.querySelectorAll('.metric-value');
        metricValues.forEach(value => {
            value.dataset.originalValue = value.textContent;
            value.textContent = '*'.repeat(value.textContent.length);
        });
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    }
}
// Update the initializeAuthUI function to store a reference to the loading indicator
function initializeAuthUI() {
    showAuthView();
    
    // Remove any existing loading indicator first
    const existingLoader = document.querySelector('.auth-loading');
    if (existingLoader) {
        existingLoader.remove();
    }
    
    // Add a loading indicator to the auth view
    const authView = document.getElementById('authView');
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'auth-loading';
    loadingIndicator.id = 'authLoadingIndicator';
    loadingIndicator.innerHTML = `
        <div class="loading-spinner"></div>
        <p>Checking for saved session...</p>
    `;
    authView.appendChild(loadingIndicator);
    
    // Set a timeout to remove the indicator if it takes too long
    setTimeout(() => {
        const indicator = document.getElementById('authLoadingIndicator');
        if (indicator) {
            indicator.remove();
        }
    }, 5000); // Remove after 5 seconds if no response
}

function setupAuthEventListeners() {
    const loginForm = document.getElementById('loginFormInner');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            
            // Add loading state to button
            const loginButton = document.getElementById('loginBtn');
            if (loginButton) loginButton.classList.add('loading');
            
            ipcRenderer.send('login', { email, password });
        });
    }

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

function initializeUI() {
    updateButtonText();
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
    console.log('Check for updates button clicked');
    ipcRenderer.send('check-for-updates');
    showNotification('Checking for updates...', 'info');
  });
ipcRenderer.on('update-status', (_event, data) => {
    console.log('[Update] Status:', data);
    
    switch(data.status) {
        case 'checking':
            showNotification('Checking for updates...', 'info');
            break;
            
        case 'available':
            showNotification(`Update available: version ${data.info.version}`, 'info');
            break;
            
        case 'not-available':
            showNotification('You have the latest version!', 'success');
            break;
            
        case 'downloading':
            const progress = Math.round(data.progress.percent);
            showNotification(`Downloading update: ${progress}%`, 'info');
            break;
            
        case 'downloaded':
            showNotification('Update downloaded and ready to install', 'success');
            break;
            
        case 'error':
            showNotification(`Update error: ${data.error}`, 'error');
            console.error('[Update] Error:', data.error);
            break;
    }
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
    document.getElementById("dailyTotalIncome").textContent =`₹${Number(todayMetrics.totalIncome).toFixed(2)}`;
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
                <td>₹${Number(metrics.totalIncome).toFixed(2)}</td>
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
    initializeMetricsVisibility();
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
        logKyc('KYC Status button clicked');
        const kycOverlayModal = document.getElementById('kycOverlayModal');
        kycOverlayModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // Prevent scrolling of background
    });

    // Close KYC modal buttons
    document.querySelectorAll('.close-kyc-modal, .close-kyc-modal-btn').forEach(button => {
        button.addEventListener('click', () => {
            logKyc('KYC modal close button clicked');
            document.getElementById('kycOverlayModal').classList.add('hidden');
            document.body.style.overflow = ''; // Restore scrolling
        });
    });

    // Submit KYC from overlay modal
    document.getElementById('submitKycOverlayBtn')?.addEventListener('click', () => {
        logKyc('Submit KYC button clicked');
        submitKycFormFromOverlay();
    });
    
    // View KYC details button
    document.getElementById('viewKycDetailsBtn')?.addEventListener('click', () => {
        logKyc('View KYC Details button clicked');
        document.getElementById('kycOverlayModal').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    });
    
    // Update KYC button
    document.getElementById('updateKycBtn')?.addEventListener('click', () => {
        logKyc('Update KYC button clicked');
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
}

// Function to load and display printer capabilities
function loadPrinterCapabilities() {
    const printerSelector = document.getElementById('printerSelector');
    const printerList = document.getElementById('printerList');
    const capabilitiesContainer = document.getElementById('printerCapabilitiesContainer');
    const saveBtn = document.getElementById('saveCapabilitiesBtn');
    const backBtn = document.getElementById('backToPrinterListBtn');
    
    if (!printerSelector || !printerList || !capabilitiesContainer) return;

    // Show the printer selector, hide capabilities container
    printerSelector.classList.remove('hidden');
    capabilitiesContainer.classList.add('hidden');
    saveBtn.classList.add('hidden');
    backBtn.classList.add('hidden');

    // Show loading state
    printerList.innerHTML = '<div class="printer-selector-loading"><div class="loading-spinner"></div>Loading printers...</div>';

    // Get the refresh button and add loading state
    const refreshBtn = document.getElementById('refreshCapabilitiesBtn');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<span class="refresh-spinner"></span> Refreshing...';
    }

    ipcRenderer.invoke('get-printers').then(({ printers, printerInfo }) => {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
        }

        if (!printers || printers.length === 0) {
            printerList.innerHTML = `
                <div class="no-printers-message" style="grid-column: 1 / -1; padding: 30px; text-align: center;">
                    <i class="fas fa-print" style="font-size: 48px; opacity: 0.3; margin-bottom: 20px;"></i>
                    <h3>No Printers Found</h3>
                    <p>Please connect and configure printers before customizing capabilities.</p>
                </div>`;
            return;
        }

        printerList.innerHTML = '';
        
        // Create a card for each printer in the printer selector
        printers.forEach(printer => {
            const printerItem = document.createElement('div');
            printerItem.className = 'printer-selector-item';
            printerItem.dataset.printerName = printer.name;
            
            const isDiscarded = printerInfo.discardedPrinters.includes(printer.name);
            const paperLevels = printerInfo.paperLevels[printer.name] || {};
            
            let totalPaper = 0;
            let lowPaper = false;
            
            for (const [size, amount] of Object.entries(paperLevels)) {
                totalPaper += amount;
                if (amount < 10) lowPaper = true;
            }
            
            printerItem.innerHTML = `
                <h4>${printer.name}</h4>
                <div class="printer-selector-item-subtitle">
                    ${Object.entries(paperLevels).length} paper ${Object.entries(paperLevels).length === 1 ? 'size' : 'sizes'} · 
                    ${totalPaper} sheets total
                </div>
                <div class="printer-selector-item-badges">
                    ${printer.capabilities.color ? 
                      '<span class="printer-badge color"><i class="fas fa-palette"></i> Color</span>' : 
                      '<span class="printer-badge monochrome"><i class="fas fa-tint"></i> Monochrome</span>'}
                    ${printer.capabilities.duplex ? 
                      '<span class="printer-badge duplex"><i class="fas fa-copy"></i> Duplex</span>' : ''}
                    ${isDiscarded ? 
                      '<span class="printer-badge discarded"><i class="fas fa-ban"></i> Discarded</span>' : ''}
                    ${lowPaper ? 
                      '<span class="printer-badge"><i class="fas fa-exclamation-triangle"></i> Low Paper</span>' : ''}
                </div>
            `;
            
            printerItem.addEventListener('click', () => {
                loadPrinterCapabilityDetails(printer.name);
            });
            
            printerList.appendChild(printerItem);
        });
    }).catch(err => {
        console.error('Error loading printer list:', err);
        printerList.innerHTML = `
            <div class="error-message" style="grid-column: 1 / -1; padding: 20px; text-align: center;">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Error loading printer list: ${err.message}</p>
                <button id="retryPrinterListBtn" class="btn btn-secondary mt-20">
                    <i class="fas fa-redo"></i> Retry
                </button>
            </div>
        `;
        
        document.getElementById('retryPrinterListBtn')?.addEventListener('click', loadPrinterCapabilities);
        
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
        }
    });
}

// Function to load the details for a specific printer
function loadPrinterCapabilityDetails(printerName) {
    const printerSelector = document.getElementById('printerSelector');
    const capabilitiesContainer = document.getElementById('printerCapabilitiesContainer');
    const saveBtn = document.getElementById('saveCapabilitiesBtn');
    const backBtn = document.getElementById('backToPrinterListBtn');
    
    // Show loading state
    capabilitiesContainer.classList.remove('hidden');
    capabilitiesContainer.innerHTML = '<div class="loading-spinner">Loading printer capabilities...</div>';
    
    // Hide the printer selector
    printerSelector.classList.add('hidden');
    
    // Show the save button and back button
    saveBtn.classList.remove('hidden');
    backBtn.classList.remove('hidden');
    
    // Add event listener to back button
    backBtn.onclick = () => {
        printerSelector.classList.remove('hidden');
        capabilitiesContainer.classList.add('hidden');
        saveBtn.classList.add('hidden');
        backBtn.classList.add('hidden');
    };

    // Fetch the specific printer's capabilities
    ipcRenderer.invoke('get-printers').then(({ printers, printerInfo }) => {
        const printer = printers.find(p => p.name === printerName);
        
        if (!printer) {
            capabilitiesContainer.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Printer "${printerName}" not found.</p>
                    <button class="btn btn-secondary mt-20" id="backToListBtn">
                        <i class="fas fa-arrow-left"></i> Back to Printer List
                    </button>
                </div>
            `;
            document.getElementById('backToListBtn').addEventListener('click', () => {
                printerSelector.classList.remove('hidden');
                capabilitiesContainer.classList.add('hidden');
                saveBtn.classList.add('hidden');
                backBtn.classList.add('hidden');
            });
            return;
        }

        // Create the capability card for this printer
        const printerCard = document.createElement('div');
        printerCard.className = 'printer-capability-card';
        
        // Card header
        const cardHeader = document.createElement('div');
        cardHeader.className = 'printer-capability-header';
        cardHeader.innerHTML = `
            <span>${printer.name}</span>
            <div>
                <span class="badge ${printerInfo.discardedPrinters.includes(printer.name) ? 'badge-danger' : 'badge-success'}">
                    ${printerInfo.discardedPrinters.includes(printer.name) ? 'Discarded' : 'Active'}
                </span>
            </div>
        `;
        printerCard.appendChild(cardHeader);
        
        // Card content
        const cardContent = document.createElement('div');
        cardContent.className = 'printer-capability-content';
        
        // Physical capabilities section
        const physicalCapabilities = document.createElement('div');
        physicalCapabilities.className = 'capability-section';
        physicalCapabilities.innerHTML = `
            <h4>Physical Capabilities <span class="feature-flag">Cannot be modified</span></h4>
            <div class="printer-capability-grid">
                <div class="capability-toggle disabled">
                    <label>
                        <i class="fas fa-palette"></i> Color Printing
                    </label>
                    <label class="toggle-switch">
                        <input type="checkbox" disabled ${printer.capabilities.color ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="capability-toggle disabled">
                    <label>
                        <i class="fas fa-copy"></i> Duplex Printing
                    </label>
                    <label class="toggle-switch">
                        <input type="checkbox" disabled ${printer.capabilities.duplex ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
            <p class="capability-description">
                These are the physical capabilities detected for this printer and cannot be modified.
            </p>
        `;
        cardContent.appendChild(physicalCapabilities);
        
        // Job routing rules section
        const jobRules = document.createElement('div');
        jobRules.className = 'capability-section job-rules-container';
        jobRules.innerHTML = `
            <h4>Job Routing Rules</h4>
            <p class="capability-description">
                Configure which types of jobs this printer should accept.
            </p>
        `;
        
        // Only show color job options if the printer supports color
        if (printer.capabilities.color) {
            const colorRule = document.createElement('div');
            colorRule.className = 'job-rule';
            colorRule.innerHTML = `
                <span class="rule-label"><i class="fas fa-palette"></i> Color Jobs:</span>
                <select class="rule-select" id="color-rule-${printer.name}" data-printer="${printer.name}" data-rule="colorJobs">
                    <option value="both" ${!printer.capabilities.colorJobsOnly && !printer.capabilities.monochromeJobsOnly ? 'selected' : ''}>Allow both color and monochrome jobs</option>
                    <option value="colorOnly" ${printer.capabilities.colorJobsOnly ? 'selected' : ''}>Only accept color jobs</option>
                    <option value="monoOnly" ${printer.capabilities.monochromeJobsOnly ? 'selected' : ''}>Only accept monochrome jobs</option>
                </select>
            `;
            jobRules.appendChild(colorRule);
        } else {
            // For monochrome printers, add a fixed message
            const monoMessage = document.createElement('div');
            monoMessage.className = 'job-rule';
            monoMessage.innerHTML = `
                <span class="rule-label"><i class="fas fa-palette"></i> Color Jobs:</span>
                <span style="flex: 1; padding: 8px; color: #666;">This printer only supports monochrome jobs</span>
            `;
            jobRules.appendChild(monoMessage);
        }
        
        // Only show duplex job options if the printer supports duplex
        if (printer.capabilities.duplex) {
            const duplexRule = document.createElement('div');
            duplexRule.className = 'job-rule';
            duplexRule.innerHTML = `
                <span class="rule-label"><i class="fas fa-copy"></i> Duplex Jobs:</span>
                <select class="rule-select" id="duplex-rule-${printer.name}" data-printer="${printer.name}" data-rule="duplexJobs">
                    <option value="both" ${!printer.capabilities.duplexJobsOnly && !printer.capabilities.simplexJobsOnly ? 'selected' : ''}>Allow both simplex and duplex jobs</option>
                    <option value="duplexOnly" ${printer.capabilities.duplexJobsOnly ? 'selected' : ''}>Only accept duplex jobs</option>
                    <option value="simplexOnly" ${printer.capabilities.simplexJobsOnly ? 'selected' : ''}>Only accept simplex jobs</option>
                </select>
            `;
            jobRules.appendChild(duplexRule);
        } else {
            // For simplex-only printers, add a fixed message
            const simplexMessage = document.createElement('div');
            simplexMessage.className = 'job-rule';
            simplexMessage.innerHTML = `
                <span class="rule-label"><i class="fas fa-copy"></i> Duplex Jobs:</span>
                <span style="flex: 1; padding: 8px; color: #666;">This printer only supports simplex jobs</span>
            `;
            jobRules.appendChild(simplexMessage);
        }
        
        // Paper sizes section
        const paperSizes = document.createElement('div');
        paperSizes.className = 'capability-section';
        paperSizes.innerHTML = `<h4>Supported Paper Sizes</h4>`;
        
        const paperSizesGrid = document.createElement('div');
        paperSizesGrid.className = 'paper-size-options';
        
        // Get the available paper sizes from the fixed paper sizes array
        const availablePaperSizes = ['A4', 'A3', 'Letter', 'Legal'];
        
        // Get the physically supported paper sizes
        const physicalPaperSizes = printer.capabilities.paperSizes;
        
        availablePaperSizes.forEach(size => {
            const isPhysicallySupported = physicalPaperSizes.includes(size);
            const isCurrentlyEnabled = printer.capabilities.paperSizes.includes(size);
            
            const paperSizeCheckbox = document.createElement('label');
            paperSizeCheckbox.className = `paper-size-checkbox ${!isPhysicallySupported ? 'disabled' : ''}`;
            
            paperSizeCheckbox.innerHTML = `
                <input type="checkbox" 
                    id="paper-${printer.name}-${size}"
                    ${isCurrentlyEnabled ? 'checked' : ''} 
                    ${!isPhysicallySupported ? 'disabled' : ''}
                    data-printer="${printer.name}" 
                    data-paper-size="${size}">
                ${size}
            `;
            
            paperSizesGrid.appendChild(paperSizeCheckbox);
        });
        
        paperSizes.appendChild(paperSizesGrid);
        paperSizes.innerHTML += `
            <p class="capability-description">
                You can disable paper sizes that are physically supported, but cannot enable unsupported sizes.
            </p>
        `;
        cardContent.appendChild(paperSizes);
        
        // Add job rules section after paper sizes
        cardContent.appendChild(jobRules);
        
        printerCard.appendChild(cardContent);
        capabilitiesContainer.innerHTML = '';
        capabilitiesContainer.appendChild(printerCard);
        
        // Set up the save button to save just this printer's capabilities
        saveBtn.onclick = () => saveSelectedPrinterCapabilities(printerName);
        
        // Add event listeners for capability controls
        setupCapabilityEventListenersForPrinter(printerName);
    }).catch(err => {
        console.error('Error loading printer capabilities:', err);
        capabilitiesContainer.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Error loading printer capabilities: ${err.message}</p>
                <button id="retryCapabilitiesBtn" class="btn btn-secondary mt-20">
                    <i class="fas fa-redo"></i> Retry
                </button>
            </div>
        `;
        
        document.getElementById('retryCapabilitiesBtn')?.addEventListener('click', () => loadPrinterCapabilityDetails(printerName));
    });
}

// Set up event listeners for capability toggles and dropdowns for a specific printer
function setupCapabilityEventListenersForPrinter(printerName) {
    // Paper size checkboxes for this printer
    document.querySelectorAll(`.paper-size-checkbox:not(.disabled) input[type="checkbox"][data-printer="${printerName}"]`).forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            console.log(`Changing support for ${this.dataset.paperSize} on ${this.dataset.printer} to ${this.checked}`);
        });
    });
    
    // Job rule selects for this printer
    document.querySelectorAll(`.rule-select[data-printer="${printerName}"]`).forEach(select => {
        select.addEventListener('change', function() {
            console.log(`Changing ${this.dataset.rule} for ${this.dataset.printer} to ${this.value}`);
        });
    });
}

// Function to save capabilities for only the selected printer
function saveSelectedPrinterCapabilities(printerName) {
    // Show loading state on save button
    const saveButton = document.getElementById('saveCapabilitiesBtn');
    if (saveButton) {
        const originalText = saveButton.innerHTML;
        saveButton.disabled = true;
        saveButton.innerHTML = '<span class="refresh-spinner"></span> Saving...';
        
        // Reset button after 2 seconds regardless of result
        setTimeout(() => {
            saveButton.disabled = false;
            saveButton.innerHTML = originalText;
        }, 2000);
    }
    
    const capabilityChanges = {};
    capabilityChanges[printerName] = {
        capabilities: {},
        paperSizes: []
    };
    
    // Process job rules for this printer
    document.querySelectorAll(`.rule-select[data-printer="${printerName}"]`).forEach(select => {
        const rule = select.dataset.rule;
        const value = select.value;
        
        if (rule === 'colorJobs') {
            capabilityChanges[printerName].capabilities.colorJobsOnly = (value === 'colorOnly');
            capabilityChanges[printerName].capabilities.monochromeJobsOnly = (value === 'monoOnly');
        } else if (rule === 'duplexJobs') {
            capabilityChanges[printerName].capabilities.duplexJobsOnly = (value === 'duplexOnly');
            capabilityChanges[printerName].capabilities.simplexJobsOnly = (value === 'simplexOnly');
        }
    });
    
    // Process paper sizes for this printer
    const paperSizes = new Set();
    document.querySelectorAll(`.paper-size-checkbox:not(.disabled) input[type="checkbox"][data-printer="${printerName}"]`).forEach(checkbox => {
        if (checkbox.checked) {
            paperSizes.add(checkbox.dataset.paperSize);
        }
    });
    
    capabilityChanges[printerName].paperSizes = Array.from(paperSizes);
    
    console.log('Saving capability changes for printer:', printerName, capabilityChanges);
    
    // Send changes to main process
    ipcRenderer.invoke('update-printer-capabilities', capabilityChanges)
        .then((result) => {
            if (result.success) {
                showNotification(`Printer ${printerName} capabilities updated successfully`, 'success');
            } else {
                showNotification(`Error: ${result.error}`, 'error');
            }
        })
        .catch(err => {
            showNotification(`Error saving printer capabilities: ${err.message}`, 'error');
        });
}

// Update the existing saveCapabilitiesChanges function to delegate to the new function
function saveCapabilitiesChanges() {
    // This function is kept for compatibility but now only calls saveSelectedPrinterCapabilities
    // with the currently visible printer, if any.
    const printerCard = document.querySelector('.printer-capability-card');
    if (printerCard) {
        const printerName = printerCard.querySelector('.printer-capability-header span').textContent;
        saveSelectedPrinterCapabilities(printerName);
    } else {
        showNotification('No printer selected', 'error');
    }
}

// Update settings tabs to load capabilities when the tab is shown
document.addEventListener('DOMContentLoaded', function() {
    // Add event listener for the capabilities tab
    document.querySelectorAll('.settings-section-button').forEach(button => {
        button.addEventListener('click', () => {
            if (button.dataset.tab === 'printersCapabilitiesTab') {
                // Load printer capabilities selector when tab is selected
                loadPrinterCapabilities();
            }
        });
    });

    // Add event listener for the refresh button
    const refreshButton = document.getElementById('refreshCapabilitiesBtn');
    if (refreshButton) {
        refreshButton.addEventListener('click', loadPrinterCapabilities);
    }
});

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
                <span>Job ${job.id} - ${job.number_of_pages} pages (${job.color_mode})</span>
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
            <td>${job.id}</td>
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
    document.getElementById('totalIncome').textContent = `₹${Number(metrics.totalIncome).toFixed(2)}`;
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

    notification.innerHTML = `
    <i class="${iconClass}"></i>
    <span>${message}</span>
    ${type === 'error' ? '<button class="notification-close">&times;</button>' : ''}
    `;
    if (type === 'error') {
        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 500);
        });
    }

    notificationContainer.appendChild(notification);

    // Auto-remove non-error notifications
    if (type !== 'error') {
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }
}
// Add to renderer.js, near other ipcRenderer.on handlers
ipcRenderer.on('clear-auth-error', () => {
    // Clear any authentication related notifications
    const notificationContainer = document.getElementById('notificationContainer');
    if (notificationContainer) {
        // Remove any error notifications
        const errorNotifications = notificationContainer.querySelectorAll('.notification.error');
        errorNotifications.forEach(notification => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 500);
        });
    }
    
    // Remove loading state from login button if it exists
    const loginButton = document.getElementById('loginBtn');
    if (loginButton) {
        loginButton.classList.remove('loading');
    }
});

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
    showNotification(`New job received: ${job.id}`, 'info');
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

// Update auth-success event listener to remove loading indicator
ipcRenderer.on('auth-success', (_event, user) => {
    // Remove loading indicator
 
    const loadingIndicator = document.getElementById('authLoadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.remove();
    }
    
    // Store the current user
    currentUser = user;
    
    // Show dashboard and other UI elements
    showDashboard();
       const username = document.getElementById('user-name');
    if (username) {
        
        username.innerHTML = user.shop_name;
    }
    const userEmail = document.getElementById('user-email');
    if (userEmail) {
        userEmail.innerHTML = user.email;
    }
    
    // Show notifications based on account status
    if (user.kyc_verified) {
        showNotification('Welcome back!', 'success');
    } else {
        displayKycReminder();
    }
});

// Update auth-error event listener to properly handle failed logins
ipcRenderer.on('auth-error', (_event, message) => {
    // Remove loading indicator
    const loadingIndicator = document.getElementById('authLoadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.remove();
    }
    
    // Remove loading state from button
    const loginButton = document.getElementById('loginBtn');
    if (loginButton) loginButton.classList.remove('loading');
    
    showNotification(`Authentication error: ${message}`, 'error');
    
    // Make sure we stay on the login page
    showAuthView();
});

// Also add a handler for session-check-complete event
ipcRenderer.on('session-check-complete', () => {
    // Remove loading indicator
    const loadingIndicator = document.getElementById('authLoadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.remove();
    }
    
    // Show login form if no session
    if (!currentUser) {
        showAuthView();
    }
});

setTimeout(() => {
    const loadingIndicator = document.getElementById('authLoadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.remove();
        showAuthView();
    }
}, 5000); // 5 second timeout

ipcRenderer.on('sign-out-success', () => {
    currentUser = null;
    showAuthView();
    showNotification('Signed out successfully', 'info');
});

function displayKycReminder() {
    logKyc('Displaying KYC reminder banner');
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
        ipcRenderer.send("fetch-shop-info", currentUser.email); // Refresh shop info
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

ipcRenderer.send("fetch-shop-info", currentUser.email); // Fetch shop info on page load

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
        logKyc(`File input changed for document type: ${documentType}`, { fileName: file?.name, size: file?.size });

        const previewContainer = document.getElementById(`${documentType}Preview`);

        if (!file) {
            logKyc(`No file selected for ${documentType}`);
            return;
        }

        try {
            // Save the file path to the dataset for later use
            const filePath = await saveFileToTemp(file);
            upload.dataset.filePath = filePath;
            logKyc(`File path saved for ${documentType}: ${filePath}`);

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
                logKyc(`Removing file: ${file.name} for document type: ${documentType}`);
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
            logKyc(`File successfully attached for document type: ${documentType}`);
        } catch (error) {
            logKyc(`Error saving file for ${documentType}: ${error}`);
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

// Add this function to check session status manually
async function checkSessionStatus() {
  try {
    const { hasSession, user } = await ipcRenderer.invoke('check-session-status');
    
    // Remove loading indicator
    const loadingIndicator = document.getElementById('authLoadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.remove();
    }
    
    if (hasSession && user) {
      // Session exists, process user login
      currentUser = user;
      showDashboard();
    }
  } catch (error) {
    console.error('Failed to check session status:', error);
    
    // Remove loading indicator on error
    const loadingIndicator = document.getElementById('authLoadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.remove();
    }
  }
}

// Call this function in case the automatic check doesn't complete
setTimeout(checkSessionStatus, 3000);

// Add this function to handle KYC overlay form submission
async function submitKycFormFromOverlay() {
    logKyc('submitKycFormFromOverlay called');
    try {
        // Collect KYC data from overlay modal fields
        const getValue = (id) => document.getElementById(id)?.value?.trim() || "";
        const getFilePath = (type) => {
            const upload = document.querySelector(`.kyc-upload[data-type="${type}"]`);
            return upload?.dataset?.filePath || "";
        };

        // Map your overlay modal's input IDs and data-types to backend fields
        const kycData = {
            address: getValue('kycAddress'),
            state: getValue('kycState'),
            account_holder_name: getValue('kycAccountHolderName'),
            account_number: getValue('kycAccountNumber'),
            ifsc_code: getValue('kycIfsc'),
            bank_name: getValue('kycBankName'),
            branch_name: getValue('kycBranchName'),
            aadhaar: getFilePath('aadhaar-front'),
            pan_card_path: getFilePath('pan-card'),
            bank_proof_path: getFilePath('bank-proof'),
            passport_photo_path: getFilePath('passport-photo'),
        };
        logKyc('Collected KYC data', kycData);

        // Validate required fields before sending
        const requiredFields = [
            'address', 'aadhaar', 'pan_card_path', 'bank_proof_path', 'passport_photo_path'
        ];
        for (const field of requiredFields) {
            if (!kycData[field]) {
                logKyc(`Missing required field: ${field}`);
                showNotification(`Missing required field: ${field.replace(/_/g, ' ')}`, 'error');
                return;
            }
        }

        // Show loading state on button
        const submitBtn = document.getElementById('submitKycOverlayBtn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="refresh-spinner"></span> Submitting...';
        }

        // Send data to main process
        logKyc('Sending KYC data to main process');
        const result = await ipcRenderer.invoke('submit-kyc-data', kycData);

        // Restore button state
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Submit KYC';
        }

        if (result.success) {
            logKyc('KYC submitted successfully');
            showNotification('KYC submitted successfully!', 'success');
            document.getElementById('kycOverlayModal').classList.add('hidden');
            document.body.style.overflow = '';
            // Optionally refresh shop info or UI
            ipcRenderer.send('fetch-shop-info', currentUser.email);
        } else {
            logKyc(`KYC submission failed: ${result.error}`);
            showNotification(`KYC submission failed: ${result.error}`, 'error');
        }
    } catch (error) {
        logKyc(`KYC error: ${error.message}`);
        showNotification(`KYC error: ${error.message}`, 'error');
        const submitBtn = document.getElementById('submitKycOverlayBtn');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Submit KYC';
        }
    }
}

// Add a helper for logging to both console and terminal
function logKyc(message, data) {
    const msg = `[KYC] ${message}` + (data ? ` | ${JSON.stringify(data)}` : '');
    console.log(msg);
    try {
        ipcRenderer.send('log-message', msg);
    } catch (e) {
        // Ignore if ipcRenderer not available
    }
}