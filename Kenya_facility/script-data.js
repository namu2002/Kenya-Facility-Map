// Data loading and management
let facilityLayers = {};
let activeLayers = new Set();

// Load all facility data
function loadAllFacilities() {
    const dataFiles = [
        'data/hotosm_ken_financial_services_points_geojson.geojson',
        'data/hotosm_ken_points_of_interest_points_geojson.geojson',
        'data/kenya_airports.geojson'
    ];

    let loadedCount = 0;
    
    dataFiles.forEach(file => {
        loadGeoJSON(file, (error, data) => {
            if (!error && data) {
                processFacilityData(data, file);
            }
            loadedCount++;
            
            if (loadedCount === dataFiles.length) {
                // All data loaded, initialize UI
                initializeLayerControls();
                updateFacilityCount();
            }
        });
    });

    // Load CSV data
    loadCSVData();
}

// Load GeoJSON data
function loadGeoJSON(filename, callback) {
    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), 30000); // 30 second timeout
    });

    // Create fetch promise
    const fetchPromise = fetch(filename)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        });

    // Race between fetch and timeout
    Promise.race([fetchPromise, timeoutPromise])
        .then(data => {
            console.log(`Loaded ${filename} successfully`);
            callback(null, data);
        })
        .catch(error => {
            console.error(`Error loading ${filename}:`, error);
            callback(error, null);
        });
}

// Process facility data from GeoJSON
function processFacilityData(data, source) {
    if (!data || !data.features) return;

    const facilities = data.features.map(feature => {
        const props = feature.properties || {};
        const coords = feature.geometry ? feature.geometry.coordinates : [0, 0];
        
        return {
            id: props.id || feature.id,
            name: props.name || props.NAME || 'Unknown Facility',
            type: props.amenity || props.type || 'facility',
            category: getCategoryFromSource(source),
            lat: coords[1],
            lng: coords[0],
            address: props['addr:street'] || props.address || '',
            phone: props.phone || props['contact:phone'] || '',
            email: props.email || props['contact:email'] || '',
            website: props.website || props.url || '',
            opening_hours: props.opening_hours || '',
            description: props.description || '',
            source: source,
            properties: props
        };
    });

    // Add to global facilities array
    window.allFacilities = window.allFacilities || [];
    window.allFacilities.push(...facilities);

    // Create layer for this data source
    createFacilityLayer(facilities, source);
}

// Get category from source filename
function getCategoryFromSource(source) {
    if (source.includes('financial_services')) return 'Financial Services';
    if (source.includes('points_of_interest')) return 'Points of Interest';
    if (source.includes('airports')) return 'Airports';
    return 'Other';
}

// Create facility layer on map
function createFacilityLayer(facilities, source) {
    const category = getCategoryFromSource(source);
    const markers = facilities.map(facility => createFacilityMarker(facility));
    
    const layerGroup = L.layerGroup(markers);
    facilityLayers[category] = layerGroup;
    
    // Add to marker cluster
    markers.forEach(marker => markerCluster.addLayer(marker));
}

// Create individual facility marker
function createFacilityMarker(facility) {
    const icon = getFacilityIcon(facility.category, facility.type);
    
    const marker = L.marker([facility.lat, facility.lng], { icon });
    
    // Create popup content
    const popupContent = createPopupContent(facility);
    marker.bindPopup(popupContent);
    
    // Store facility data with marker
    marker.facilityData = facility;
    
    // Add click event
    marker.on('click', () => {
        selectedFacility = facility;
        updateFacilityInfo(facility);
    });
    
    return marker;
}

// Get appropriate icon for facility
function getFacilityIcon(category, type) {
    const iconClasses = {
        'Financial Services': 'fas fa-university',
        'Points of Interest': 'fas fa-landmark',
        'Airports': 'fas fa-plane',
        'Other': 'fas fa-map-marker-alt'
    };
    
    const iconClass = iconClasses[category] || iconClasses['Other'];
    
    return L.divIcon({
        className: 'facility-marker',
        html: `<i class="${iconClass}"></i>`,
        iconSize: [25, 25],
        iconAnchor: [12, 25],
        popupAnchor: [0, -25]
    });
}

// Create popup content for facility
function createPopupContent(facility) {
    return `
        <div class="facility-popup">
            <h4>${facility.name}</h4>
            <p><strong>Type:</strong> ${facility.type}</p>
            <p><strong>Category:</strong> ${facility.category}</p>
            ${facility.address ? `<p><strong>Address:</strong> ${facility.address}</p>` : ''}
            ${facility.phone ? `<p><strong>Phone:</strong> ${facility.phone}</p>` : ''}
            <div class="popup-actions">
                <button onclick="getDirections(${facility.lat}, ${facility.lng})">
                    <i class="fas fa-directions"></i> Directions
                </button>
                <button onclick="showFacilityDetails('${facility.id}')">
                    <i class="fas fa-info"></i> Details
                </button>
            </div>
        </div>
    `;
}

// Load CSV data
function loadCSVData() {
    fetch('kenya_facilities.csv')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.text();
        })
        .then(csvText => {
            const facilities = parseCSV(csvText);
            window.allFacilities = window.allFacilities || [];
            window.allFacilities.push(...facilities);
            
            // Create layer for CSV facilities
            createFacilityLayer(facilities, 'CSV Data');
            console.log('CSV data loaded successfully');
        })
        .catch(error => {
            console.error('Error loading CSV:', error);
            showNotification('Error loading facility data', 'error');
        });
}

// Parse CSV data
function parseCSV(csvText) {
    const lines = csvText.split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    
    return lines.slice(1)
        .filter(line => line.trim())
        .map(line => {
            const values = line.split(',').map(v => v.trim());
            const facility = {};
            
            headers.forEach((header, index) => {
                facility[header] = values[index] || '';
            });
            
            // Ensure coordinates exist
            facility.lat = parseFloat(facility.lat || facility.latitude || 0);
            facility.lng = parseFloat(facility.lng || facility.longitude || 0);
            facility.name = facility.name || facility.Name || 'Unknown Facility';
            facility.category = 'CSV Data';
            
            return facility;
        })
        .filter(f => !isNaN(f.lat) && !isNaN(f.lng) && f.lat !== 0 && f.lng !== 0);
}

// Initialize layer controls
function initializeLayerControls() {
    const layerControl = document.getElementById('layerControl');
    if (!layerControl) return;

    layerControl.innerHTML = '';
    
    Object.keys(facilityLayers).forEach(category => {
        const layerItem = document.createElement('div');
        layerItem.className = 'layer-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `layer-${category.replace(/\s+/g, '-')}`;
        checkbox.checked = true; // Show all layers by default
        checkbox.addEventListener('change', () => toggleLayer(category, checkbox.checked));
        
        const label = document.createElement('label');
        label.htmlFor = checkbox.id;
        label.textContent = category;
        
        layerItem.appendChild(checkbox);
        layerItem.appendChild(label);
        layerControl.appendChild(layerItem);
        
        // Add to active layers
        activeLayers.add(category);
    });
    
    // Add test markers to ensure something shows
    addTestMarkers();
    
    // Hide loading spinner after initialization
    if (typeof hideLoading === 'function') {
        hideLoading();
    }
}

// Add test markers to verify map is working
function addTestMarkers() {
    if (!map) return;
    
    console.log('Adding test markers...');
    
    const testFacilities = [
        {
            id: 'test1',
            name: 'Nairobi Test',
            type: 'test',
            category: 'Test',
            lat: -1.2921,
            lng: 36.8219,
            address: 'Test marker for debugging'
        },
        {
            id: 'test2',
            name: 'Mombasa Test',
            type: 'test',
            category: 'Test',
            lat: -4.0635,
            lng: 39.6581,
            address: 'Another test marker'
        }
    ];
    
    testFacilities.forEach(facility => {
        const marker = createFacilityMarker(facility);
        if (marker) {
            markerCluster.addLayer(marker);
            console.log('Added test marker:', facility.name);
        }
    });
    
    console.log('Test markers added:', testFacilities.length);
}

// Toggle layer visibility
function toggleLayer(category, show) {
    const layer = facilityLayers[category];
    if (!layer) return;
    
    if (show) {
        map.addLayer(layer);
        activeLayers.add(category);
    } else {
        map.removeLayer(layer);
        activeLayers.delete(category);
    }
    
    updateFacilityCount();
}

// Update facility count display
function updateFacilityCount() {
    const countElement = document.getElementById('facilityCount');
    if (!countElement) return;
    
    const activeFacilities = window.allFacilities ? window.allFacilities.filter(f => activeLayers.has(f.category)) : [];
    countElement.textContent = `${activeFacilities.length} facilities`;
}

// Show facility details
function showFacilityDetails(facilityId) {
    const facility = window.allFacilities.find(f => f.id === facilityId);
    if (facility) {
        selectedFacility = facility;
        updateFacilityInfo(facility);
        
        const detailsPanel = document.getElementById('facilityDetails');
        if (detailsPanel) {
            detailsPanel.classList.add('active');
        }
    }
}
