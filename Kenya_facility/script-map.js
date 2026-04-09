// Global variables for map functionality
let map = null;
let facilities = [];
let allFacilities = []; // Store all facilities for heatmap
let markers = [];
let markerCluster = null;
let currentLayer = 'streets';
let heatmapLayer = null;
let userLocation = null;
let selectedFacility = null;

// Map initialization
function initMap() {
    // Initialize the map centered on Kenya
    map = L.map('map').setView([1.2921, 36.8219], 6); // Centered on Nairobi

    // Add base layers
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    });

    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri'
    });

    const terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap'
    });

    // Add default layer
    streets.addTo(map);

    // Layer control
    const baseMaps = {
        "Streets": streets,
        "Satellite": satellite,
        "Terrain": terrain
    };

    L.control.layers(baseMaps).addTo(map);

    // Initialize marker cluster group
    markerCluster = L.markerClusterGroup({
        chunkedLoading: true,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: true,
        zoomToBoundsOnClick: true
    });

    map.addLayer(markerCluster);

    // Load initial data
    loadAllFacilities();

    // Add map events
    map.on('click', onMapClick);
    map.on('locationfound', onLocationFound);
    map.on('locationerror', onLocationError);
}

// Map click handler
function onMapClick(e) {
    // Remove previous selection
    if (selectedFacility) {
        selectedFacility = null;
        updateFacilityInfo(null);
    }

    // Find nearest facility to clicked point
    findNearestFacility(e.latlng);
}

// Location found handler
function onLocationFound(e) {
    userLocation = e.latlng;
    
    // Add user location marker
    if (window.userMarker) {
        map.removeLayer(window.userMarker);
    }
    
    window.userMarker = L.marker(e.latlng, {
        icon: L.divIcon({
            className: 'user-location-marker',
            html: '<i class="fas fa-user-circle"></i>',
            iconSize: [20, 20]
        })
    }).addTo(map);

    // Find nearest facilities to user location
    findNearestFacilities(e.latlng, 5);
}

// Location error handler
function onLocationError(e) {
    console.error('Location error:', e.message);
    showNotification('Unable to get your location', 'error');
}

// Find nearest facility
function findNearestFacility(latlng) {
    let nearestFacility = null;
    let minDistance = Infinity;

    facilities.forEach(facility => {
        const distance = latlng.distanceTo([facility.lat, facility.lng]);
        if (distance < minDistance) {
            minDistance = distance;
            nearestFacility = facility;
        }
    });

    if (nearestFacility) {
        selectedFacility = nearestFacility;
        updateFacilityInfo(nearestFacility);
        
        // Highlight the nearest facility
        highlightNearestFacility(nearestFacility);
    }
}

// Find multiple nearest facilities
function findNearestFacilities(latlng, count = 5) {
    const facilitiesWithDistance = facilities.map(facility => ({
        ...facility,
        distance: latlng.distanceTo([facility.lat, facility.lng])
    }));

    facilitiesWithDistance.sort((a, b) => a.distance - b.distance);
    
    const nearestFacilities = facilitiesWithDistance.slice(0, count);
    showNearestFacilities(nearestFacilities);
}

// Highlight nearest facility
function highlightNearestFacility(facility) {
    // Remove existing highlight
    if (window.highlightMarker) {
        map.removeLayer(window.highlightMarker);
    }

    // Add highlight marker
    window.highlightMarker = L.marker([facility.lat, facility.lng], {
        icon: L.divIcon({
            className: 'highlight-marker',
            html: '<i class="fas fa-star"></i>',
            iconSize: [30, 30]
        })
    }).addTo(map);

    // Pan to facility
    map.panTo([facility.lat, facility.lng]);
}

// Show nearest facilities list
function showNearestFacilities(facilities) {
    const nearestList = document.getElementById('nearestFacilities');
    if (!nearestList) return;

    nearestList.innerHTML = '<h3>Nearest Facilities</h3>';
    
    facilities.forEach((facility, index) => {
        const distance = (facility.distance / 1000).toFixed(2); // Convert to km
        const item = document.createElement('div');
        item.className = 'nearest-facility-item';
        item.innerHTML = `
            <div class="facility-rank">${index + 1}</div>
            <div class="facility-info">
                <h4>${facility.name}</h4>
                <p>${facility.type || 'Facility'}</p>
                <p class="distance">${distance} km away</p>
            </div>
            <button class="view-facility-btn" onclick="viewFacility(${JSON.stringify(facility).replace(/"/g, '&quot;')})">
                <i class="fas fa-eye"></i>
            </button>
        `;
        nearestList.appendChild(item);
    });
}

// View specific facility
function viewFacility(facility) {
    selectedFacility = facility;
    updateFacilityInfo(facility);
    highlightNearestFacility(facility);
    
    // Show facility details panel
    const detailsPanel = document.getElementById('facilityDetails');
    if (detailsPanel) {
        detailsPanel.classList.add('active');
    }
}

// Update facility information panel
function updateFacilityInfo(facility) {
    const infoPanel = document.getElementById('facilityInfo');
    if (!infoPanel) return;

    if (!facility) {
        infoPanel.innerHTML = '<p>No facility selected</p>';
        return;
    }

    infoPanel.innerHTML = `
        <h3>${facility.name || 'Unknown Facility'}</h3>
        <div class="facility-details">
            <p><strong>Type:</strong> ${facility.type || 'N/A'}</p>
            <p><strong>Category:</strong> ${facility.category || 'N/A'}</p>
            ${facility.address ? `<p><strong>Address:</strong> ${facility.address}</p>` : ''}
            ${facility.phone ? `<p><strong>Phone:</strong> ${facility.phone}</p>` : ''}
            ${facility.email ? `<p><strong>Email:</strong> ${facility.email}</p>` : ''}
            <p><strong>Coordinates:</strong> ${facility.lat.toFixed(6)}, ${facility.lng.toFixed(6)}</p>
        </div>
        <div class="facility-actions">
            <button onclick="getDirections(${facility.lat}, ${facility.lng})">
                <i class="fas fa-directions"></i> Get Directions
            </button>
            <button onclick="shareFacility(${JSON.stringify(facility).replace(/"/g, '&quot;')})">
                <i class="fas fa-share"></i> Share
            </button>
        </div>
    `;
}
