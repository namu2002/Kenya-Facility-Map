// Main application controller
// This file coordinates all functionality and initializes the application

// Application state
const app = {
    initialized: false,
    currentView: 'map',
    filters: {
        categories: [],
        types: [],
        query: ''
    }
};

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing Kenya Facilities Map...');
    console.log('Checking available functions:');
    console.log('- initMap:', typeof initMap);
    console.log('- initSearch:', typeof initSearch);
    console.log('- initializeComponents:', typeof initializeComponents);
    
    // Initialize map first
    if (typeof initMap === 'function') {
        console.log('Calling initMap...');
        initMap();
    } else {
        console.error('initMap function not found!');
    }
    
    // Initialize other components
    setTimeout(() => {
        initializeComponents();
        app.initialized = true;
        
        // Hide loading spinner immediately
        if (typeof hideLoading === 'function') {
            hideLoading();
        }
        
        showNotification('Kenya Facilities Map loaded successfully', 'success');
    }, 1000);
});

// Initialize all components
function initializeComponents() {
    // Initialize search
    if (typeof initSearch === 'function') {
        initSearch();
    }
    
    // Initialize UI controls
    initializeUIControls();
    
    // Initialize event listeners
    initializeEventListeners();
    
    // Load user preferences
    loadUserPreferences();
    
    // Check for URL parameters
    handleURLParameters();
}

// Initialize UI controls
function initializeUIControls() {
    // Map view toggle
    const mapViewBtn = document.getElementById('mapViewBtn');
    const listViewBtn = document.getElementById('listViewBtn');
    
    if (mapViewBtn) {
        mapViewBtn.addEventListener('click', () => switchView('map'));
    }
    
    if (listViewBtn) {
        listViewBtn.addEventListener('click', () => switchView('list'));
    }
    
    // Heat map toggle
    const heatmapToggle = document.getElementById('heatmapToggle');
    if (heatmapToggle) {
        heatmapToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                showHeatmap();
            } else {
                hideHeatmap();
            }
        });
    }
    
    // Location button
    const locationBtn = document.getElementById('locationBtn');
    if (locationBtn) {
        locationBtn.addEventListener('click', getUserLocation);
    }
    
    // Export buttons
    const exportCSVBtn = document.getElementById('exportCSV');
    const exportJSONBtn = document.getElementById('exportJSON');
    const exportGeoJSONBtn = document.getElementById('exportGeoJSON');
    
    if (exportCSVBtn) {
        exportCSVBtn.addEventListener('click', () => exportData('csv'));
    }
    
    if (exportJSONBtn) {
        exportJSONBtn.addEventListener('click', () => exportData('json'));
    }
    
    if (exportGeoJSONBtn) {
        exportGeoJSONBtn.addEventListener('click', () => exportData('geojson'));
    }
    
    // Filter controls
    initializeFilters();
}

// Initialize event listeners
function initializeEventListeners() {
    // Window resize
    window.addEventListener('resize', debounce(handleResize, 250));
    
    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
    
    // Online/offline status
    window.addEventListener('online', () => {
        showNotification('Connection restored', 'success');
    });
    
    window.addEventListener('offline', () => {
        showNotification('Connection lost - some features may not work', 'warning');
    });
}

// Initialize filters
function initializeFilters() {
    const categoryFilters = document.querySelectorAll('.category-filter');
    const typeFilters = document.querySelectorAll('.type-filter');
    
    categoryFilters.forEach(filter => {
        filter.addEventListener('change', (e) => {
            const category = e.target.value;
            if (e.target.checked) {
                app.filters.categories.push(category);
            } else {
                app.filters.categories = app.filters.categories.filter(c => c !== category);
            }
            applyFilters();
        });
    });
    
    typeFilters.forEach(filter => {
        filter.addEventListener('change', (e) => {
            const type = e.target.value;
            if (e.target.checked) {
                app.filters.types.push(type);
            } else {
                app.filters.types = app.filters.types.filter(t => t !== type);
            }
            applyFilters();
        });
    });
}

// Switch between map and list views
function switchView(view) {
    app.currentView = view;
    
    const mapViewBtn = document.getElementById('mapViewBtn');
    const listViewBtn = document.getElementById('listViewBtn');
    const mapContainer = document.getElementById('map');
    const listContainer = document.getElementById('facilityList');
    
    if (view === 'map') {
        if (mapViewBtn) mapViewBtn.classList.add('active');
        if (listViewBtn) listViewBtn.classList.remove('active');
        if (mapContainer) mapContainer.style.display = 'block';
        if (listContainer) listContainer.style.display = 'none';
        
        // Refresh map
        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 100);
    } else {
        if (mapViewBtn) mapViewBtn.classList.remove('active');
        if (listViewBtn) listViewBtn.classList.add('active');
        if (mapContainer) mapContainer.style.display = 'none';
        if (listContainer) listContainer.style.display = 'block';
        
        // Populate list view
        populateListView();
    }
}

// Populate list view
function populateListView() {
    const listContainer = document.getElementById('facilityList');
    if (!listContainer || !window.allFacilities) return;
    
    const filteredFacilities = getFilteredFacilities();
    
    listContainer.innerHTML = '';
    
    if (filteredFacilities.length === 0) {
        listContainer.innerHTML = '<div class="no-facilities">No facilities found</div>';
        return;
    }
    
    filteredFacilities.forEach(facility => {
        const item = createListItem(facility);
        listContainer.appendChild(item);
    });
}

// Create list item for facility
function createListItem(facility) {
    const item = document.createElement('div');
    item.className = 'facility-list-item';
    
    item.innerHTML = `
        <div class="list-item-icon">
            <i class="${getFacilityIconClass(facility.category, facility.type)}"></i>
        </div>
        <div class="list-item-content">
            <h4>${facility.name}</h4>
            <p class="list-item-type">${facility.type}</p>
            <p class="list-item-category">${facility.category}</p>
            ${facility.address ? `<p class="list-item-address">${facility.address}</p>` : ''}
        </div>
        <div class="list-item-actions">
            <button onclick="viewFacility(${JSON.stringify(facility).replace(/"/g, '&quot;')})" class="btn-view">
                <i class="fas fa-eye"></i>
            </button>
            <button onclick="getDirections(${facility.lat}, ${facility.lng})" class="btn-directions">
                <i class="fas fa-directions"></i>
            </button>
        </div>
    `;
    
    return item;
}

// Apply filters to facilities
function applyFilters() {
    const filteredFacilities = getFilteredFacilities();
    
    // Update map markers
    updateMapMarkers(filteredFacilities);
    
    // Update list view if active
    if (app.currentView === 'list') {
        populateListView();
    }
    
    // Update count
    updateFacilityCount();
}

// Get filtered facilities
function getFilteredFacilities() {
    if (!window.allFacilities) return [];
    
    return window.allFacilities.filter(facility => {
        // Category filter
        if (app.filters.categories.length > 0) {
            if (!app.filters.categories.includes(facility.category)) {
                return false;
            }
        }
        
        // Type filter
        if (app.filters.types.length > 0) {
            if (!app.filters.types.includes(facility.type)) {
                return false;
            }
        }
        
        // Text filter
        if (app.filters.query.trim()) {
            const query = app.filters.query.toLowerCase();
            const searchableText = [
                facility.name,
                facility.type,
                facility.category,
                facility.address
            ].join(' ').toLowerCase();
            
            if (!searchableText.includes(query)) {
                return false;
            }
        }
        
        return true;
    });
}

// Update map markers based on filtered facilities
function updateMapMarkers(filteredFacilities) {
    // Clear existing markers
    markerCluster.clearLayers();
    
    // Add markers for filtered facilities
    filteredFacilities.forEach(facility => {
        const marker = createFacilityMarker(facility);
        markerCluster.addLayer(marker);
    });
}

// Show heatmap
function showHeatmap() {
    if (!window.allFacilities || window.allFacilities.length === 0) return;
    
    const heatData = window.allFacilities
        .filter(f => f.lat && f.lng)
        .map(f => [f.lat, f.lng, 1.0]);
    
    if (heatmapLayer) {
        map.removeLayer(heatmapLayer);
    }
    
    heatmapLayer = L.heatLayer(heatData, {
        radius: 25,
        blur: 15,
        maxZoom: 17,
        gradient: {
            0.4: 'blue',
            0.6: 'cyan',
            0.7: 'lime',
            0.8: 'yellow',
            1.0: 'red'
        }
    }).addTo(map);
    
    showNotification('Heatmap enabled', 'info');
}

// Hide heatmap
function hideHeatmap() {
    if (heatmapLayer) {
        map.removeLayer(heatmapLayer);
        heatmapLayer = null;
        showNotification('Heatmap disabled', 'info');
    }
}

// Get user location
function getUserLocation() {
    showNotification('Getting your location...', 'info');
    
    getCurrentLocation()
        .then(location => {
            userLocation = location;
            
            // Add marker for user location
            if (window.userMarker) {
                map.removeLayer(window.userMarker);
            }
            
            window.userMarker = L.marker([location.lat, location.lng], {
                icon: L.divIcon({
                    className: 'user-location-marker',
                    html: '<i class="fas fa-user-circle"></i>',
                    iconSize: [20, 20]
                })
            }).addTo(map);
            
            // Center map on user location
            map.setView([location.lat, location.lng], 13);
            
            showNotification('Location found successfully', 'success');
            
            // Find nearest facilities
            findNearestFacilities(L.latLng(location.lat, location.lng), 5);
        })
        .catch(error => {
            console.error('Error getting location:', error);
            showNotification('Unable to get your location', 'error');
        });
}

// Handle window resize
function handleResize() {
    if (map && app.currentView === 'map') {
        map.invalidateSize();
    }
}

// Handle keyboard shortcuts
function handleKeyboardShortcuts(e) {
    // Ctrl/Cmd + F: Focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        const searchBox = document.getElementById('searchBox');
        if (searchBox) {
            searchBox.focus();
        }
    }
    
    // Escape: Clear search/close modals
    if (e.key === 'Escape') {
        clearSearchResults();
        const detailsPanel = document.getElementById('facilityDetails');
        if (detailsPanel) {
            detailsPanel.classList.remove('active');
        }
    }
    
    // Ctrl/Cmd + E: Export data
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        exportData('csv');
    }
}

// Load user preferences
function loadUserPreferences() {
    // Load saved preferences from localStorage
    const preferences = localStorage.getItem('kenyaFacilitiesPrefs');
    
    if (preferences) {
        try {
            const prefs = JSON.parse(preferences);
            
            // Apply saved preferences
            if (prefs.defaultView) {
                switchView(prefs.defaultView);
            }
            
            if (prefs.defaultLayer) {
                // Set default map layer
                // Implementation depends on your layer control
            }
            
        } catch (error) {
            console.error('Error loading preferences:', error);
        }
    }
}

// Save user preferences
function saveUserPreferences() {
    const preferences = {
        defaultView: app.currentView,
        defaultLayer: currentLayer,
        timestamp: Date.now()
    };
    
    localStorage.setItem('kenyaFacilitiesPrefs', JSON.stringify(preferences));
}

// Handle URL parameters
function handleURLParameters() {
    const params = new URLSearchParams(window.location.search);
    
    // Handle specific facility
    const facilityId = params.get('facility');
    if (facilityId && window.allFacilities) {
        const facility = window.allFacilities.find(f => f.id === facilityId);
        if (facility) {
            setTimeout(() => {
                viewFacility(facility);
            }, 2000);
        }
    }
    
    // Handle initial view
    const view = params.get('view');
    if (view && ['map', 'list'].includes(view)) {
        switchView(view);
    }
    
    // Handle initial search
    const query = params.get('search');
    if (query) {
        const searchBox = document.getElementById('searchBox');
        if (searchBox) {
            searchBox.value = query;
            handleSearch();
        }
    }
}

// Save preferences before unload
window.addEventListener('beforeunload', saveUserPreferences);

// Error handling
window.addEventListener('error', (e) => {
    console.error('Application error:', e.error);
    showNotification('An error occurred. Please refresh the page.', 'error');
});

// Performance monitoring
window.addEventListener('load', () => {
    const loadTime = performance.now();
    console.log(`Application loaded in ${loadTime.toFixed(2)}ms`);
});

// Hide loading spinner
function hideLoading() {
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
        loadingElement.style.display = 'none';
    }
}

// Export app state for debugging
window.appState = app;
