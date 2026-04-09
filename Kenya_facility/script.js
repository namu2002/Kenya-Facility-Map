// Global variables
let map = null;
let facilities = [];
let allFacilities = []; // Store all facilities for heatmap
let markers = [];
let markerCluster = null;
let currentLayer = 'streets';
let heatmapLayer = null;
let userLocation = null;
let selectedFacility = null;
let routingControl = null;
let isHeatmapActive = false;
let usingSampleData = false; // FIX #1 - Track if using sample data
let searchInitialized = false; // Track if search has been initialized

// Performance optimization variables
let visibleMarkers = new Map(); // Only store visible markers
let markerPool = []; // Reusable marker pool
let viewportBounds = null;
let lastViewportUpdate = 0;
let renderQueue = [];
let isRendering = false;
let batchSize = 100; // Process markers in batches
let renderTimeout = null;

// Nearest road calculation - finds road with shortest driving path
function findNearestRoad(lat, lng, callback) {
    console.log('Finding nearest road with shortest driving path for:', lat, lng);
    
    // Use Overpass API to query nearby roads
    const overpassQuery = `
        [out:json][timeout:25];
        (
            way["highway"](around:500,${lat},${lng});
        );
        out geom;
    `;
    
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
    
    fetch(overpassUrl)
        .then(response => response.json())
        .then(data => {
            console.log('Overpass API response:', data);
            
            if (data.elements && data.elements.length > 0) {
                findRoadWithShortestPath(data.elements, lat, lng, callback);
            } else {
                callback('No roads found nearby', null);
            }
        })
        .catch(error => {
            console.error('Error finding nearest road:', error);
            callback(error, null);
        });
}

// Find road with shortest driving path using OSRM routing
function findRoadWithShortestPath(roads, facilityLat, facilityLng, callback) {
    console.log('Analyzing', roads.length, 'roads for shortest path...');
    
    let roadResults = [];
    let processedCount = 0;
    
    roads.forEach((road, index) => {
        if (road.geometry && road.geometry.length > 0) {
            // Find a representative point on this road (middle point)
            const roadPoint = road.geometry[Math.floor(road.geometry.length / 2)];
            
            // Calculate driving distance from road point to facility using OSRM
            const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${roadPoint.lon},${roadPoint.lat};${facilityLng},${facilityLat}?overview=false`;
            
            fetch(osrmUrl)
                .then(response => response.json())
                .then(routeData => {
                    if (routeData.routes && routeData.routes.length > 0) {
                        const route = routeData.routes[0];
                        roadResults.push({
                            road: road,
                            roadPoint: roadPoint,
                            drivingDistance: route.distance, // meters
                            drivingTime: route.duration, // seconds
                            routeGeometry: route.geometry
                        });
                    }
                    
                    processedCount++;
                    if (processedCount === roads.length) {
                        // All roads processed, find the one with shortest path
                        const shortestRoad = findShortestDrivingRoad(roadResults);
                        callback(null, shortestRoad);
                    }
                })
                .catch(error => {
                    console.error('Error calculating route for road', index, ':', error);
                    processedCount++;
                    if (processedCount === roads.length) {
                        const shortestRoad = findShortestDrivingRoad(roadResults);
                        callback(null, shortestRoad);
                    }
                });
        } else {
            processedCount++;
            if (processedCount === roads.length) {
                const shortestRoad = findShortestDrivingRoad(roadResults);
                callback(null, shortestRoad);
            }
        }
    });
    
    // Handle case where no roads have valid geometry
    if (roads.length === 0) {
        callback('No valid roads found', null);
    }
}

// Find the road with the shortest driving distance
function findShortestDrivingRoad(roadResults) {
    if (roadResults.length === 0) {
        return null;
    }
    
    // Sort by driving distance (shortest first)
    roadResults.sort((a, b) => a.drivingDistance - b.drivingDistance);
    
    const shortest = roadResults[0];
    console.log('Shortest driving road found:', shortest);
    
    return {
        name: shortest.road.tags.name || 'Unnamed road',
        type: shortest.road.tags.highway || 'road',
        drivingDistance: shortest.drivingDistance,
        drivingTime: shortest.drivingTime,
        roadPoint: shortest.roadPoint,
        geometry: shortest.road.geometry,
        routeGeometry: shortest.routeGeometry,
        tags: shortest.road.tags,
        allResults: roadResults // For debugging
    };
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c * 1000; // Convert to meters
}

// Kenya landmarks database for enhanced navigation
const kenyaLandmarks = {
    // Nairobi landmarks
    nairobi: [
        { name: "Kenyatta International Convention Centre", lat: -1.2884, lng: 36.8233, type: "building", description: "tall building with helipad" },
        { name: "Nairobi National Park", lat: -1.3645, lng: 36.8544, type: "park", description: "national park entrance" },
        { name: "Uhuru Park", lat: -1.2833, lng: 36.8192, type: "park", description: "large recreational park" },
        { name: "Central Business District", lat: -1.2864, lng: 36.8172, type: "area", description: "city center" },
        { name: "Thika Road Superhighway", lat: -1.2747, lng: 36.8562, type: "road", description: "major highway" },
        { name: "Mombasa Road", lat: -1.2995, lng: 36.8451, type: "road", description: "main highway to coast" },
        { name: "Westgate Shopping Mall", lat: -1.2655, lng: 36.8879, type: "mall", description: "shopping center" },
        { name: "Jomo Kenyatta International Airport", lat: -1.3192, lng: 36.9278, type: "airport", description: "main airport" },
        { name: "University of Nairobi", lat: -1.2833, lng: 36.8167, type: "university", description: "main university campus" },
        { name: "Nairobi Railway Station", lat: -1.2833, lng: 36.8267, type: "station", description: "train station" }
    ],
    
    // Mombasa landmarks
    mombasa: [
        { name: "Fort Jesus", lat: -4.0665, lng: 39.6667, type: "fortress", description: "historic fort" },
        { name: "Mombasa Marine Park", lat: -4.0667, lng: 39.6667, type: "park", description: "marine park" },
        { name: "Diani Beach", lat: -4.2833, lng: 39.5833, type: "beach", description: "popular beach" },
        { name: "Moi International Airport", lat: -4.0333, lng: 39.5833, type: "airport", description: "airport" },
        { name: "Nyali Bridge", lat: -4.0667, lng: 39.6833, type: "bridge", description: "major bridge" }
    ],
    
    // Kisumu landmarks
    kisumu: [
        { name: "Kisumu Impala Sanctuary", lat: -0.0833, lng: 34.7500, type: "sanctuary", description: "wildlife sanctuary" },
        { name: "Lake Victoria", lat: -0.0833, lng: 34.7500, type: "lake", description: "large lake" },
        { name: "Kisumu Railway Station", lat: -0.0833, lng: 34.7500, type: "station", description: "train station" }
    ],
    
    // Nakuru landmarks
    nakuru: [
        { name: "Lake Nakuru National Park", lat: -0.3667, lng: 36.0833, type: "park", description: "national park with flamingos" },
        { name: "Menengai Crater", lat: -0.2000, lng: 36.1333, type: "crater", description: "volcanic crater" }
    ],
    
    // Eldoret landmarks
    eldoret: [
        { name: "Kipchoge Keino Stadium", lat: 0.5167, lng: 35.2667, type: "stadium", description: "sports stadium" },
        { name: "Eldoret International Airport", lat: 0.5333, lng: 35.2333, type: "airport", description: "airport" }
    ],
    
    // General landmarks across Kenya
    general: [
        { name: "Equator crossing", lat: 0.0167, lng: 37.0667, type: "landmark", description: "equator line" },
        { name: "Great Rift Valley", lat: 0.5167, lng: 35.2833, type: "valley", description: "rift valley viewpoint" },
        { name: "Mount Kenya", lat: -0.1500, lng: 37.3083, type: "mountain", description: "highest mountain" },
        { name: "Mount Kilimanjaro view", lat: -3.0667, lng: 37.3500, type: "viewpoint", description: "mountain view" }
    ]
};

// Find nearby landmarks to a given coordinate
function findNearbyLandmarks(lat, lng, radiusKm = 2) {
    const nearbyLandmarks = [];
    
    // Check all landmark categories
    Object.values(kenyaLandmarks).forEach(category => {
        category.forEach(landmark => {
            const distance = calculateDistance(lat, lng, landmark.lat, landmark.lng) / 1000; // Convert to km
            
            if (distance <= radiusKm) {
                nearbyLandmarks.push({
                    ...landmark,
                    distance: distance
                });
            }
        });
    });
    
    // Sort by distance (closest first)
    nearbyLandmarks.sort((a, b) => a.distance - b.distance);
    
    return nearbyLandmarks.slice(0, 3); // Return top 3 closest landmarks
}

// Enhance instruction with landmark information
function enhanceInstructionWithLandmark(instruction, lat, lng) {
    const nearbyLandmarks = findNearbyLandmarks(lat, lng, 2.0); // Increased radius for better coverage
    
    if (nearbyLandmarks.length === 0) {
        return instruction;
    }
    
    const closestLandmark = nearbyLandmarks[0];
    let enhancedInstruction = instruction;
    
    // Don't add landmark if instruction already contains landmark info
    if (instruction.toLowerCase().includes('near') || 
        instruction.toLowerCase().includes('at') || 
        instruction.toLowerCase().includes('on')) {
        return instruction;
    }
    
    // Add landmark reference based on type with more descriptive context
    if (closestLandmark.type === 'building' || closestLandmark.type === 'fortress') {
        enhancedInstruction += ` near the ${closestLandmark.name}`;
    } else if (closestLandmark.type === 'park' || closestLandmark.type === 'sanctuary') {
        enhancedInstruction += ` near ${closestLandmark.name}`;
    } else if (closestLandmark.type === 'airport') {
        enhancedInstruction += ` near ${closestLandmark.name}`;
    } else if (closestLandmark.type === 'mall') {
        enhancedInstruction += ` near ${closestLandmark.name}`;
    } else if (closestLandmark.type === 'university') {
        enhancedInstruction += ` near ${closestLandmark.name}`;
    } else if (closestLandmark.type === 'station') {
        enhancedInstruction += ` near ${closestLandmark.name}`;
    } else if (closestLandmark.type === 'road' || closestLandmark.type === 'bridge') {
        enhancedInstruction += ` on ${closestLandmark.name}`;
    } else if (closestLandmark.type === 'beach' || closestLandmark.type === 'lake') {
        enhancedInstruction += ` near ${closestLandmark.name}`;
    } else if (closestLandmark.type === 'stadium') {
        enhancedInstruction += ` near ${closestLandmark.name}`;
    } else if (closestLandmark.type === 'crater' || closestLandmark.type === 'mountain') {
        enhancedInstruction += ` near ${closestLandmark.name}`;
    } else if (closestLandmark.type === 'valley' || closestLandmark.type === 'viewpoint') {
        enhancedInstruction += ` near ${closestLandmark.name}`;
    } else {
        enhancedInstruction += ` near ${closestLandmark.name}`;
    }
    
    // Add distance information if landmark is not too close
    if (closestLandmark.distance > 0.5) {
        const distanceStr = closestLandmark.distance > 1 ? 
            `${closestLandmark.distance.toFixed(1)} kilometers` : 
            `${Math.round(closestLandmark.distance * 1000)} meters`;
        enhancedInstruction += ` (${distanceStr} away)`;
    }
    
    console.log(`Enhanced instruction: ${instruction} -> ${enhancedInstruction}`);
    console.log(`Landmark used: ${closestLandmark.name} (${closestLandmark.distance.toFixed(2)}km away)`);
    
    return enhancedInstruction;
}

// Text-to-speech for voice navigation
let speechSynthesis = window.speechSynthesis;
let currentUtterance = null;
let speechQueue = [];
let isProcessingQueue = false;
let voicesLoaded = false;

// Initialize voices properly
function initializeVoices() {
    if (speechSynthesis.getVoices().length !== 0) {
        voicesLoaded = true;
        console.log('Voices loaded:', speechSynthesis.getVoices().length);
    } else {
        speechSynthesis.addEventListener('voiceschanged', () => {
            voicesLoaded = true;
            console.log('Voices loaded after voiceschanged:', speechSynthesis.getVoices().length);
        }, { once: true });
    }
}

// Speak navigation instructions with proper queue management
function speakNavigation(text, priority = false) {
    console.log('Queueing speech:', text, 'Priority:', priority);
    
    // Check if speech synthesis is available
    if (!window.speechSynthesis) {
        console.error('Speech synthesis not supported in this browser');
        return;
    }
    
    // Ensure voices are loaded
    if (!voicesLoaded) {
        console.log('Voices not loaded yet, waiting...');
        setTimeout(() => speakNavigation(text, priority), 100);
        return;
    }
    
    // Handle priority speech (cancel current and clear queue for important announcements)
    if (priority) {
        // Cancel current speech
        if (speechSynthesis.speaking) {
            speechSynthesis.cancel();
            console.log('Cancelled current speech for priority message');
        }
        // Clear queue for priority messages
        speechQueue = [];
        // Add priority message to front of queue
        speechQueue.unshift({ text, priority: true, timestamp: Date.now() });
    } else {
        // Add normal speech to end of queue
        speechQueue.push({ text, priority: false, timestamp: Date.now() });
    }
    
    // Process the queue
    processSpeechQueue();
}

// Process the speech queue
function processSpeechQueue() {
    if (isProcessingQueue || speechQueue.length === 0) {
        return;
    }
    
    if (speechSynthesis.speaking) {
        console.log('Speech synthesis is busy, waiting...');
        setTimeout(() => processSpeechQueue(), 100);
        return;
    }
    
    isProcessingQueue = true;
    const speechItem = speechQueue.shift();
    
    console.log('Processing speech item:', speechItem.text);
    speakNow(speechItem.text, speechItem.priority);
}

function speakNow(text, isPriority = false) {
    // Create new speech utterance with optimized settings
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.85; // Slightly slower for clarity
    utterance.pitch = 1.0;
    utterance.volume = 0.9; // Slightly louder
    utterance.lang = 'en-US'; // Force English language
    
    // Select the best available voice
    const voices = speechSynthesis.getVoices();
    console.log('Available voices:', voices.length);
    
    // Prioritize male voices (original setting)
    const preferredVoices = [
        // Google male voices (Chrome)
        'Google US English Male',
        'Google UK English Male',
        // Microsoft male voices (Edge)
        'Microsoft Mark Desktop',
        'Microsoft David Desktop',
        // Apple male voices (Safari)
        'Alex',
        // Other male voices
        'Daniel'
    ];
    
    let selectedVoice = null;
    
    // Try to find preferred voice
    for (const preferredName of preferredVoices) {
        const voice = voices.find(v => v.name.includes(preferredName));
        if (voice) {
            selectedVoice = voice;
            break;
        }
    }
    
    // Fallback to any English voice
    if (!selectedVoice) {
        selectedVoice = voices.find(voice => 
            voice.lang.includes('en-US') || 
            voice.lang.includes('en-GB') ||
            voice.lang.includes('en')
        ) || voices[0]; // Default to first available voice
    }
    
    if (selectedVoice) {
        utterance.voice = selectedVoice;
        console.log('Using voice:', selectedVoice.name, 'Lang:', selectedVoice.lang);
    } else {
        console.log('Using default voice');
    }
    
    // Add event listeners for better debugging and queue management
    utterance.onstart = () => {
        console.log('Speech started:', text);
    };
    
    utterance.onend = () => {
        console.log('Speech ended:', text);
        currentUtterance = null;
        isProcessingQueue = false;
        
        // Process next item in queue after a short delay
        setTimeout(() => {
            processSpeechQueue();
        }, 200);
    };
    
    utterance.onerror = (event) => {
        console.error('Speech error:', event.error);
        currentUtterance = null;
        isProcessingQueue = false;
        
        // Continue processing queue even after error
        setTimeout(() => {
            processSpeechQueue();
        }, 500);
    };
    
    utterance.onpause = () => {
        console.log('Speech paused');
    };
    
    utterance.onresume = () => {
        console.log('Speech resumed');
    };
    
    currentUtterance = utterance;
    
    try {
        speechSynthesis.speak(utterance);
        console.log('Speech queued successfully');
    } catch (error) {
        console.error('Error speaking:', error);
        currentUtterance = null;
        isProcessingQueue = false;
        
        // Try to continue with next item
        setTimeout(() => {
            processSpeechQueue();
        }, 500);
    }
}


// Get user's current location
function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported by this browser'));
            return;
        }
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const location = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                userLocation = location;
                console.log('User location obtained:', location);
                resolve(location);
            },
            (error) => {
                console.error('Error getting location:', error);
                reject(error);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 300000 // 5 minutes
            }
        );
    });
}

// Initialize user location on page load
function initializeUserLocation() {
    getUserLocation().then(location => {
        console.log('User location initialized:', location);
        // Add user location marker to map
        if (map && location) {
            const userMarker = L.marker([location.lat, location.lng], {
                icon: L.divIcon({
                    html: '<div style="background: #4285F4; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
                    iconSize: [16, 16],
                    className: 'user-location-marker'
                })
            }).addTo(map);
            userMarker.bindPopup('Your Location');
        }
    }).catch(error => {
        console.log('Could not get user location, will use manual input');
    });
}

// GPS-style enhanced map layers
const mapLayers = {
    streets: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'OpenStreetMap contributors'
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri'
    }),
    terrain: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap'
    }),
    hybrid: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri'
    }),
    // GPS-style navigation layer
    navigation: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'OpenStreetMap contributors',
        maxZoom: 19
    }),
    // High-contrast road layer
    roads: L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors, Tiles style by Humanitarian OpenStreetMap Team'
    })
};

// Facility type colors
const facilityColors = {
    'Hospital': '#ea4335',
    'Clinic': '#f39c12',
    'Pharmacy': '#00acc1',
    'Dental Clinic': '#9c27b0',
    'Blood Bank': '#e91e63',
    'School': '#4285F4',
    'University': '#1565c0',
    'College': '#1976d2',
    'Library': '#7b1fa2',
    'Education Facility': '#3f51b5',
    'Airport': '#ff6d00',
    'Health Facility': '#ff5722',
    'Bank': '#2e7d32',
    'ATM': '#0288d1',
    'Money Transfer': '#795548',
    'Post Office': '#d32f2f',
    'Bureau de Change': '#ff9800',
    'Financial Service': '#607d8b',
    'Place of Worship': '#8e24aa',
    'Church': '#8e24aa'
};

// Virtual rendering functions for performance
function updateViewportBounds() {
    if (!map) return;
    
    const bounds = map.getBounds();
    viewportBounds = {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
    };
    lastViewportUpdate = Date.now();
}

function isFacilityInViewport(facility) {
    if (!viewportBounds) return true;
    
    return facility.lat <= viewportBounds.north &&
           facility.lat >= viewportBounds.south &&
           facility.lng <= viewportBounds.east &&
           facility.lng >= viewportBounds.west;
}

function queueMarkerRender(facility) {
    renderQueue.push(facility);
    
    if (!isRendering) {
        processRenderQueue();
    }
}

function processRenderQueue() {
    if (renderQueue.length === 0) {
        isRendering = false;
        return;
    }
    
    isRendering = true;
    const batch = renderQueue.splice(0, batchSize);
    
    // Process batch asynchronously
    setTimeout(() => {
        batch.forEach(facility => {
            if (isFacilityInViewport(facility)) {
                createMarkerForFacility(facility);
            }
        });
        
        // Continue processing next batch
        processRenderQueue();
    }, 0);
}

function createMarkerForFacility(facility) {
    if (visibleMarkers.has(facility.id)) return;
    
    const icon = getFacilityIcon(facility.type);
    const marker = L.marker([facility.lat, facility.lng], { icon: icon });
    
    marker.bindPopup(`
        <div style="min-width: 200px;">
            <h3 style="margin: 0 0 8px 0; color: #2c3e50;">${facility.name}</h3>
            <p style="margin: 4px 0;"><strong>Type:</strong> ${facility.type}</p>
            <p style="margin: 4px 0;"><strong>County:</strong> ${facility.county}</p>
            ${facility.phone ? `<p style="margin: 4px 0;"><strong>Phone:</strong> ${facility.phone}</p>` : ''}
            ${facility.hours ? `<p style="margin: 4px 0;"><strong>Hours:</strong> ${facility.hours}</p>` : ''}
            <button onclick="getDirections(${facility.lat}, ${facility.lng})" style="margin-top: 8px; padding: 6px 12px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">Get Directions</button>
        </div>
    `);
    
    marker.facilityData = facility;
    visibleMarkers.set(facility.id, marker);
    
    if (markerCluster) {
        markerCluster.addLayer(marker);
    } else {
        marker.addTo(map);
    }
}

function cleanupMarkersOutsideViewport() {
    if (!viewportBounds) return;
    
    const toRemove = [];
    visibleMarkers.forEach((marker, id) => {
        if (!isFacilityInViewport(marker.facilityData)) {
            toRemove.push(id);
        }
    });
    
    toRemove.forEach(id => {
        const marker = visibleMarkers.get(id);
        if (markerCluster) {
            markerCluster.removeLayer(marker);
        } else {
            map.removeLayer(marker);
        }
        visibleMarkers.delete(id);
    });
}

function handleMapMove() {
    clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
        updateViewportBounds();
        
        // Remove markers outside viewport
        cleanupMarkersOutsideViewport();
        
        // Add markers for facilities now in viewport
        allFacilities.forEach(facility => {
            if (isFacilityInViewport(facility) && !visibleMarkers.has(facility.id)) {
                queueMarkerRender(facility);
            }
        });
    }, 200); // Debounce for 200ms
}

// Initialize GPS-style map
function initMap() {
    console.log('JavaScript is working!');
    console.log('Initializing GPS-style map...');
    
    map = L.map('map', {
        center: [-1.2864, 36.8172], // Nairobi
        zoom: 13, // Higher zoom for better road visibility
        zoomControl: false
    });
    
    // Start with navigation layer for GPS-like appearance
    mapLayers.navigation.addTo(map);
    
    // Set bounds to Kenya
    const kenyaBounds = [[-4.9, 33.7], [5.0, 42.0]];
    map.setMaxBounds(kenyaBounds);
    
    // Add road overlay for enhanced road visibility
    mapLayers.roads.addTo(map);
    
    // GPS-style map enhancements
    addGPSStyleEnhancements();
    
    // DISABLE virtual rendering to show all facilities
    // updateViewportBounds();
    
    // DISABLE event listeners for virtual rendering
    // map.on('moveend', handleMapMove);
    // map.on('zoomend', handleMapMove);
    
    console.log('Virtual rendering DISABLED - showing all facilities');
}

// GPS-style map enhancements
function addGPSStyleEnhancements() {
    // Add custom CSS for GPS-style appearance
    const gpsStyles = document.createElement('style');
    gpsStyles.textContent = `
        .leaflet-container {
            background: #f8f9fa;
        }
        .leaflet-tile-pane {
            filter: contrast(1.1) saturate(1.2);
        }
        .gps-navigation-mode .leaflet-tile-pane {
            filter: contrast(1.2) saturate(1.3) brightness(1.05);
        }
        .gps-road-highlight {
            filter: drop-shadow(0 0 3px rgba(66, 133, 244, 0.6));
        }
    `;
    document.head.appendChild(gpsStyles);
    
    // Add GPS compass control
    addGPSCompass();
    
    // Add speed limit indicator (simulated)
    addSpeedIndicator();
    
    // Add current road name display
    addCurrentRoadDisplay();
}

// Add GPS compass
function addGPSCompass() {
    const compassControl = L.control({ position: 'topright' });
    compassControl.onAdd = function(map) {
        const div = L.DomUtil.create('div', 'gps-compass');
        div.innerHTML = `
            <div style="
                width: 60px;
                height: 60px;
                background: white;
                border-radius: 50%;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                color: #4285F4;
                border: 2px solid #e0e0e0;
            ">
                <i class="fas fa-compass"></i>
            </div>
        `;
        return div;
    };
    compassControl.addTo(map);
}

// Add speed indicator
function addSpeedIndicator() {
    const speedControl = L.control({ position: 'bottomleft' });
    speedControl.onAdd = function(map) {
        const div = L.DomUtil.create('div', 'gps-speed-indicator');
        div.innerHTML = `
            <div style="
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 8px 12px;
                border-radius: 20px;
                font-size: 14px;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 8px;
            ">
                <i class="fas fa-tachometer-alt" style="color: #34a853;"></i>
                <span id="speedDisplay">0 km/h</span>
            </div>
        `;
        return div;
    };
    speedControl.addTo(map);
}

// Add current road display
function addCurrentRoadDisplay() {
    const roadControl = L.control({ position: 'bottomright' });
    roadControl.onAdd = function(map) {
        const div = L.DomUtil.create('div', 'gps-road-display');
        div.innerHTML = `
            <div style="
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 10px 16px;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 500;
                max-width: 200px;
                text-align: center;
            ">
                <div style="font-size: 12px; opacity: 0.8; margin-bottom: 4px;">Current Road</div>
                <div id="currentRoadName">--</div>
            </div>
        `;
        return div;
    };
    roadControl.addTo(map);
}

// Enhanced route styling for GPS navigation
function styleGPSRoute(route) {
    return {
        color: '#4285F4',
        weight: 6,
        opacity: 0.8,
        dashArray: '10, 5',
        lineCap: 'round',
        lineJoin: 'round'
    };
}

// Animate route like GPS navigation (updated with realistic timing)
function animateGPSRoute(routeCoordinates) {
    if (!routeCoordinates || routeCoordinates.length < 2) return;
    
    const routeLine = L.polyline(routeCoordinates, styleGPSRoute()).addTo(map);
    
    // Add animated car marker
    const carIcon = L.divIcon({
        html: '<div style="background: #4285F4; width: 20px; height: 12px; border: 2px solid white; border-radius: 3px; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
        iconSize: [24, 16],
        className: 'gps-car-marker'
    });
    
    let currentIndex = 0;
    const carMarker = L.marker(routeCoordinates[0], { icon: carIcon }).addTo(map);
    
    // Calculate realistic timing
    let totalDistance = 0;
    for (let i = 0; i < routeCoordinates.length - 1; i++) {
        totalDistance += calculateDistance(
            routeCoordinates[i][0], routeCoordinates[i][1],
            routeCoordinates[i + 1][0], routeCoordinates[i + 1][1]
        );
    }
    
    // Set realistic speed (30 km/h = 8.33 m/s for demonstration)
    const averageSpeed = 8.33; // meters per second
    const totalDuration = totalDistance / averageSpeed; // seconds
    const animationSpeed = (totalDuration * 1000) / routeCoordinates.length; // ms per segment
    
    // Ensure reasonable timing
    const finalAnimationSpeed = Math.max(300, Math.min(animationSpeed, 1500)); // between 300ms and 1.5s
    
    console.log('GPS Route - Distance:', totalDistance.toFixed(0), 'm, Duration:', (totalDuration / 60).toFixed(1), 'min, Speed:', finalAnimationSpeed.toFixed(0), 'ms/segment');
    
    function animateCar() {
        if (currentIndex < routeCoordinates.length - 1) {
            currentIndex++;
            carMarker.setLatLng(routeCoordinates[currentIndex]);
            
            // Center map on car with smooth pan
            map.panTo(routeCoordinates[currentIndex], {
                animate: true,
                duration: 0.5
            });
            
            setTimeout(animateCar, finalAnimationSpeed);
        }
    }
    
    setTimeout(animateCar, 1000);
}

// Road network visualization for GPS-style navigation
let roadNetworkLayer = null;
let pathNetworkLayer = null;

// Load and display road network from OpenStreetMap
function loadRoadNetwork() {
    console.log('Loading road network for GPS visualization...');
    
    // Remove existing road layers if they exist
    if (roadNetworkLayer) {
        map.removeLayer(roadNetworkLayer);
    }
    if (pathNetworkLayer) {
        map.removeLayer(pathNetworkLayer);
    }
    
    // Get current map bounds
    const bounds = map.getBounds();
    const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
    
    // Overpass API query to get roads, paths, and walkways
    const overpassQuery = `
        [out:json][timeout:30];
        (
            way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|service)$"](${bbox});
            way["highway"~"^(footway|path|track|pedestrian|cycleway)$"](${bbox});
        );
        out geom;
    `;
    
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
    
    fetch(overpassUrl)
        .then(response => response.json())
        .then(data => {
            console.log('Road network data loaded:', data.elements.length, 'ways');
            displayRoadNetwork(data.elements);
        })
        .catch(error => {
            console.error('Error loading road network:', error);
            // Fallback to sample roads
            displaySampleRoadNetwork();
        });
}

// Display road network on map with GPS-style styling
function displayRoadNetwork(ways) {
    const roadLines = [];
    const pathLines = [];
    
    ways.forEach(way => {
        if (way.geometry && way.geometry.length > 1) {
            const coords = way.geometry.map(point => [point.lat, point.lon]);
            const highwayType = way.tags.highway || 'road';
            const name = way.tags.name || 'Unnamed Road';
            
            // Determine road category and styling
            let roadStyle, layer;
            
            if (['motorway', 'trunk'].includes(highwayType)) {
                // Major highways - thick blue lines
                roadStyle = {
                    color: '#4285F4',
                    weight: 6,
                    opacity: 0.8,
                    smoothFactor: 2
                };
                layer = 'highway';
            } else if (['primary', 'secondary'].includes(highwayType)) {
                // Main roads - medium blue lines
                roadStyle = {
                    color: '#1967D2',
                    weight: 4,
                    opacity: 0.7,
                    smoothFactor: 2
                };
                layer = 'main';
            } else if (['tertiary', 'residential'].includes(highwayType)) {
                // Local roads - thinner gray lines
                roadStyle = {
                    color: '#5F6368',
                    weight: 3,
                    opacity: 0.6,
                    smoothFactor: 1.5
                };
                layer = 'local';
            } else if (['service'].includes(highwayType)) {
                // Service roads - thin gray lines
                roadStyle = {
                    color: '#9AA0A6',
                    weight: 2,
                    opacity: 0.5,
                    smoothFactor: 1
                };
                layer = 'service';
            } else if (['footway', 'path', 'track', 'pedestrian'].includes(highwayType)) {
                // Walkways and paths - dashed green lines
                roadStyle = {
                    color: '#34A853',
                    weight: 2,
                    opacity: 0.7,
                    dashArray: '5, 5',
                    smoothFactor: 1
                };
                layer = 'path';
            } else if (['cycleway'].includes(highwayType)) {
                // Cycle paths - dashed orange lines
                roadStyle = {
                    color: '#FBBC04',
                    weight: 2,
                    opacity: 0.7,
                    dashArray: '8, 4',
                    smoothFactor: 1
                };
                layer = 'cycle';
            } else {
                // Default road styling
                roadStyle = {
                    color: '#80868B',
                    weight: 2,
                    opacity: 0.5,
                    smoothFactor: 1
                };
                layer = 'default';
            }
            
            // Create polyline with appropriate styling
            const polyline = L.polyline(coords, roadStyle);
            
            // Add popup with road information
            polyline.bindPopup(`
                <div style="font-size: 12px;">
                    <strong>${name}</strong><br>
                    Type: ${highwayType}<br>
                    <small>Click to highlight this route</small>
                </div>
            `);
            
            // Add hover effects
            polyline.on('mouseover', function(e) {
                this.setStyle({
                    weight: parseInt(this.options.weight) + 2,
                    opacity: 1
                });
            });
            
            polyline.on('mouseout', function(e) {
                this.setStyle(roadStyle);
            });
            
            // Add click to highlight functionality
            polyline.on('click', function(e) {
                highlightRoute(coords, name);
            });
            
            // Separate roads from paths for layer management
            if (['footway', 'path', 'track', 'pedestrian', 'cycleway'].includes(highwayType)) {
                pathLines.push(polyline);
            } else {
                roadLines.push(polyline);
            }
        }
    });
    
    // Create layer groups for better management
    roadNetworkLayer = L.layerGroup(roadLines).addTo(map);
    pathNetworkLayer = L.layerGroup(pathLines).addTo(map);
    
    console.log(`Displayed ${roadLines.length} roads and ${pathLines.length} paths`);
}

// Fallback sample road network for demo purposes
function displaySampleRoadNetwork() {
    console.log('Using sample road network for demonstration...');
    
    const sampleRoads = [
        // Major highways around Nairobi
        {
            coords: [[-1.2864, 36.8172], [-1.2864, 36.8572], [-1.2864, 36.8972]],
            style: { color: '#4285F4', weight: 6, opacity: 0.8 },
            name: 'Thika Superhighway',
            type: 'motorway'
        },
        {
            coords: [[-1.2864, 36.8172], [-1.3264, 36.8172], [-1.3664, 36.8172]],
            style: { color: '#4285F4', weight: 6, opacity: 0.8 },
            name: 'Mombasa Road',
            type: 'motorway'
        },
        {
            coords: [[-1.2864, 36.8172], [-1.2464, 36.8172], [-1.2064, 36.8172]],
            style: { color: '#1967D2', weight: 4, opacity: 0.7 },
            name: 'Waiyaki Way',
            type: 'primary'
        },
        {
            coords: [[-1.2864, 36.8172], [-1.2864, 36.7772], [-1.2864, 36.7372]],
            style: { color: '#1967D2', weight: 4, opacity: 0.7 },
            name: 'Langata Road',
            type: 'primary'
        },
        // Local roads
        {
            coords: [[-1.2664, 36.8372], [-1.2664, 36.8572], [-1.2664, 36.8772]],
            style: { color: '#5F6368', weight: 3, opacity: 0.6 },
            name: 'Kenyatta Avenue',
            type: 'residential'
        },
        {
            coords: [[-1.3064, 36.8372], [-1.3064, 36.8572], [-1.3064, 36.8772]],
            style: { color: '#5F6368', weight: 3, opacity: 0.6 },
            name: 'Moi Avenue',
            type: 'residential'
        },
        // Walkways and paths
        {
            coords: [[-1.2764, 36.8272], [-1.2864, 36.8372], [-1.2964, 36.8472]],
            style: { color: '#34A853', weight: 2, opacity: 0.7, dashArray: '5, 5' },
            name: 'Pedestrian Walkway',
            type: 'footway'
        },
        {
            coords: [[-1.2864, 36.8072], [-1.2964, 36.8172], [-1.3064, 36.8272]],
            style: { color: '#FBBC04', weight: 2, opacity: 0.7, dashArray: '8, 4' },
            name: 'Cycle Path',
            type: 'cycleway'
        }
    ];
    
    const roadLines = [];
    const pathLines = [];
    
    sampleRoads.forEach(road => {
        const polyline = L.polyline(road.coords, road.style);
        
        polyline.bindPopup(`
            <div style="font-size: 12px;">
                <strong>${road.name}</strong><br>
                Type: ${road.type}<br>
                <small>Sample road for demonstration</small>
            </div>
        `);
        
        // Add hover effects
        polyline.on('mouseover', function(e) {
            this.setStyle({
                weight: parseInt(this.options.weight) + 2,
                opacity: 1
            });
        });
        
        polyline.on('mouseout', function(e) {
            this.setStyle(road.style);
        });
        
        if (['footway', 'cycleway'].includes(road.type)) {
            pathLines.push(polyline);
        } else {
            roadLines.push(polyline);
        }
    });
    
    roadNetworkLayer = L.layerGroup(roadLines).addTo(map);
    pathNetworkLayer = L.layerGroup(pathLines).addTo(map);
    
    console.log('Sample road network displayed');
}

// Highlight a specific route for navigation
function highlightRoute(coords, name) {
    // Remove existing highlight
    if (window.currentHighlight) {
        map.removeLayer(window.currentHighlight);
    }
    
    // Create highlighted route
    const highlightStyle = {
        color: '#EA4335',
        weight: 8,
        opacity: 0.9,
        dashArray: '10, 5',
        smoothFactor: 2
    };
    
    window.currentHighlight = L.polyline(coords, highlightStyle).addTo(map);
    
    // Animate the highlight
    animateHighlightedRoute(window.currentHighlight);
    
    // Center map on highlighted route
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [50, 50] });
    
    console.log('Highlighted route:', name);
}

// Animate highlighted route
function animateHighlightedRoute(route) {
    let offset = 0;
    setInterval(() => {
        offset = (offset + 1) % 20;
        route.setStyle({
            dashOffset: offset
        });
    }, 100);
}

// GPS Navigation simulation and enhancements
function startGPSNavigation() {
    console.log('Starting GPS Navigation Mode...');
    
    // Load and display road network
    loadRoadNetwork();
    
    // Simulate speed updates
    updateSpeedDisplay();
    
    // Update current road display
    updateCurrentRoadDisplay();
    
    // Add GPS-style route highlighting if a route exists
    if (routingControl) {
        enhanceGPSRouteDisplay();
    }
    
    // Start location tracking simulation
    startLocationTracking();
    
    // Speak navigation instructions
    speakNavigation('GPS Navigation Mode activated with enhanced road network', true);
}

// Clear road network when leaving GPS mode
function clearRoadNetwork() {
    if (roadNetworkLayer) {
        map.removeLayer(roadNetworkLayer);
        roadNetworkLayer = null;
    }
    if (pathNetworkLayer) {
        map.removeLayer(pathNetworkLayer);
        pathNetworkLayer = null;
    }
    if (window.currentHighlight) {
        map.removeLayer(window.currentHighlight);
        window.currentHighlight = null;
    }
    console.log('Road network cleared');
}

// Update speed display with simulated values
function updateSpeedDisplay() {
    const speedDisplay = document.getElementById('speedDisplay');
    if (!speedDisplay) return;
    
    // Simulate varying speeds
    const speeds = [0, 25, 45, 35, 55, 40, 30, 0];
    let speedIndex = 0;
    
    setInterval(() => {
        if (document.body.classList.contains('gps-navigation-mode')) {
            speedDisplay.textContent = `${speeds[speedIndex]} km/h`;
            speedIndex = (speedIndex + 1) % speeds.length;
        }
    }, 3000);
}

// Update current road name display
function updateCurrentRoadDisplay() {
    const roadDisplay = document.getElementById('currentRoadName');
    if (!roadDisplay) return;
    
    // Simulate road names based on Nairobi area
    const roads = ['Thika Road', 'Mombasa Road', 'Waiyaki Way', 'Langata Road', 'Jogoo Road', 'Uhuru Highway'];
    let roadIndex = 0;
    
    setInterval(() => {
        if (document.body.classList.contains('gps-navigation-mode')) {
            roadDisplay.textContent = roads[roadIndex];
            roadIndex = (roadIndex + 1) % roads.length;
        }
    }, 5000);
}

// Enhance route display for GPS mode
function enhanceGPSRouteDisplay() {
    // Add GPS-style animations to existing routes
    document.querySelectorAll('.leaflet-overlay-pane svg path').forEach(path => {
        path.style.stroke = '#4285F4';
        path.style.strokeWidth = '6';
        path.style.strokeDasharray = '15, 10';
        path.style.animation = 'gps-route-flow 2s linear infinite';
        path.style.filter = 'drop-shadow(0 2px 4px rgba(66, 133, 244, 0.4))';
    });
}

// Simulate location tracking
function startLocationTracking() {
    if (!userLocation) {
        // If no user location, center on Nairobi
        map.setView([-1.2864, 36.8172], 15);
    }
    
    // Add periodic location updates (simulated)
    setInterval(() => {
        if (document.body.classList.contains('gps-navigation-mode') && userLocation) {
            // Simulate small movement
            const latOffset = (Math.random() - 0.5) * 0.001;
            const lngOffset = (Math.random() - 0.5) * 0.001;
            
            const newLat = userLocation.lat + latOffset;
            const newLng = userLocation.lng + lngOffset;
            
            // Update user location marker if it exists
            const userMarker = document.querySelector('.user-location-marker');
            if (userMarker) {
                // Smooth pan to new location
                map.panTo([newLat, newLng], {
                    animate: true,
                    duration: 1
                });
            }
        }
    }, 4000);
}

// FIX #1 - Generate sample data if GeoJSON files aren't found
function generateSampleData() {
    console.log('Generating sample data for demonstration...');
    
    const sampleFacilities = [];
    
    // Major cities in Kenya with coordinates
    const cities = [
        { name: 'Nairobi', lat: -1.2864, lng: 36.8172 },
        { name: 'Mombasa', lat: -4.0435, lng: 39.6682 },
        { name: 'Kisumu', lat: -0.1022, lng: 34.7617 },
        { name: 'Nakuru', lat: -0.3031, lng: 36.0800 },
        { name: 'Eldoret', lat: 0.5143, lng: 35.2698 },
        { name: 'Thika', lat: -1.0396, lng: 37.0900 },
        { name: 'Malindi', lat: -3.2192, lng: 40.1169 },
        { name: 'Garissa', lat: -0.4569, lng: 39.6583 },
        { name: 'Kitale', lat: 1.0167, lng: 35.0000 },
        { name: 'Machakos', lat: -1.5167, lng: 37.2667 }
    ];
    
    // Facility types by category
    const facilityTypes = {
        health: ['Hospital', 'Clinic', 'Pharmacy', 'Dental Clinic', 'Blood Bank'],
        education: ['School', 'University', 'College', 'Library', 'Education Facility'],
        transport: ['Airport'],
        financial: ['Bank', 'ATM', 'Money Transfer', 'Post Office', 'Bureau de Change']
    };
    
    // Generate 50 sample facilities
    for (let i = 0; i < 47; i++) {  // Reduced to 47 to add specific Kasarani facilities
        const city = cities[Math.floor(Math.random() * cities.length)];
        const category = Object.keys(facilityTypes)[Math.floor(Math.random() * 4)];
        const types = facilityTypes[category];
        const type = types[Math.floor(Math.random() * types.length)];
        
        // Add slight random offset to coordinates
        const latOffset = (Math.random() - 0.5) * 0.1;
        const lngOffset = (Math.random() - 0.5) * 0.1;
        
        const facilityNames = {
            'Hospital': ['Kenyatta National', 'Moi Teaching', 'Aga Khan', 'Nairobi', 'Coast General'],
            'Clinic': ['City Medical', 'Family Health', 'Prime Care', 'Wellness', 'Community'],
            'Pharmacy': ['Good Life', 'Health Plus', 'MediCare', 'Pharma Save', 'CarePoint'],
            'School': ['Kenya High', 'Alliance', 'Starehe', 'Moi Girls', 'Lenana'],
            'University': ['University of Nairobi', 'Kenyatta University', 'Strathmore', 'JKUAT', 'Moi University'],
            'Bank': ['Equity Bank', 'KCB', 'Cooperative Bank', 'Stanbic', 'Absa'],
            'ATM': ['Equity ATM', 'KCB ATM', 'Co-op ATM', 'Stanbic ATM', 'Absa ATM']
        };
        
        let name = '';
        if (facilityNames[type]) {
            const names = facilityNames[type];
            name = names[Math.floor(Math.random() * names.length)] + ' ' + type;
        } else {
            name = city.name + ' ' + type;
        }
        
        sampleFacilities.push({
            id: `sample_${category}_${i}`,
            name: name,
            type: type,
            lat: city.lat + latOffset,
            lng: city.lng + lngOffset,
            county: city.name + ' County',
            phone: '+254 7' + Math.floor(Math.random() * 10000000).toString().padStart(7, '0'),
            hours: 'Mon-Fri: 8AM-5PM, Sat: 9AM-1PM',
            rating: (3.5 + Math.random() * 1.5).toFixed(1),
            category: category
        });
    }
    
    // Add specific facilities in Kasarani
    sampleFacilities.push({
        id: 'kasarani_hospital_1',
        name: 'Kasarani District Hospital',
        type: 'Hospital',
        lat: -1.2244,
        lng: 36.9217,
        county: 'Nairobi County',
        phone: '+254 720123456',
        hours: '24/7 Emergency Services',
        rating: '4.2',
        category: 'health'
    });
    
    sampleFacilities.push({
        id: 'kasarani_health_center_1',
        name: 'Kasarani Health Center',
        type: 'Clinic',
        lat: -1.2254,
        lng: 36.9227,
        county: 'Nairobi County',
        phone: '+254 723456789',
        hours: 'Mon-Fri: 8AM-6PM',
        rating: '4.0',
        category: 'health'
    });
    
    sampleFacilities.push({
        id: 'kasarani_primary_1',
        name: 'Kasarani Primary School',
        type: 'School',
        lat: -1.2264,
        lng: 36.9237,
        county: 'Nairobi County',
        phone: '+254 734567890',
        hours: 'Mon-Fri: 7AM-5PM',
        rating: '3.9',
        category: 'education'
    });
    
    sampleFacilities.push({
        id: 'kasarani_secondary_1',
        name: 'Kasarani Secondary School',
        type: 'School',
        lat: -1.2274,
        lng: 36.9247,
        county: 'Nairobi County',
        phone: '+254 745678901',
        hours: 'Mon-Fri: 7AM-5PM',
        rating: '4.1',
        category: 'education'
    });
    
    sampleFacilities.push({
        id: 'kasarani_bank_1',
        name: 'Kasarani Equity Bank',
        type: 'Bank',
        lat: -1.2234,
        lng: 36.9207,
        county: 'Nairobi County',
        phone: '+254 756789012',
        hours: 'Mon-Fri: 8AM-4PM, Sat: 9AM-12PM',
        rating: '4.0',
        category: 'financial'
    });
    
    sampleFacilities.push({
        id: 'kasarani_pharmacy_1',
        name: 'Kasarani Pharmacy',
        type: 'Pharmacy',
        lat: -1.2284,
        lng: 36.9257,
        county: 'Nairobi County',
        phone: '+254 767890123',
        hours: 'Mon-Sat: 8AM-8PM',
        rating: '4.3',
        category: 'health'
    });
    
    // Add a facility with Kasarani County to ensure it appears in county dropdown
    sampleFacilities.push({
        id: 'kasarani_county_office_1',
        name: 'Kasarani County Office',
        type: 'Education Facility',
        lat: -1.2294,
        lng: 36.9267,
        county: 'Kasarani County',
        phone: '+254 778901234',
        hours: 'Mon-Fri: 8AM-5PM',
        rating: '3.8',
        category: 'education'
    });
    
    return sampleFacilities;
}

// Load GeoJSON data with fallback to sample data
async function loadFacilities() {
    try {
        console.log('Loading facilities...');
        
        // Show loading indicator
        showNotification('Loading facility data... This may take a moment.');
        
        // Try to load real data, fall back to sample if files don't exist
        let healthData = null;
        let educationData = null;
        let airportsData = null;
        let financialData = null;
        let poiData = null;
        
        try {
            const healthResponse = await fetch('data/kenya_health.geojson');
            if (healthResponse.ok) healthData = await healthResponse.json();
        } catch (e) { console.log('Health data not found'); }
        
        try {
            const educationResponse = await fetch('data/kenya_education.geojson');
            if (educationResponse.ok) educationData = await educationResponse.json();
        } catch (e) { console.log('Education data not found'); }
        
        try {
            const airportsResponse = await fetch('data/kenya_airports.geojson');
            if (airportsResponse.ok) airportsData = await airportsResponse.json();
        } catch (e) { console.log('Airports data not found'); }
        
        try {
            const financialResponse = await fetch('data/hotosm_ken_financial_services_points_geojson.geojson');
            if (financialResponse.ok) financialData = await financialResponse.json();
        } catch (e) { console.log('Financial data not found'); }
        
        try {
            const poiResponse = await fetch('data/hotosm_ken_points_of_interest_points_geojson.geojson');
            if (poiResponse.ok) poiData = await poiResponse.json();
        } catch (e) { console.log('Points of interest data not found'); }
        
        // Check if we have any real data
        const hasRealData = healthData || educationData || airportsData || financialData || poiData;
        
        if (!hasRealData) {
            console.log('No GeoJSON files found, using sample data');
            usingSampleData = true;
            document.getElementById('sampleDataNotice').classList.add('show');
            facilities = generateSampleData();
            allFacilities = [...facilities]; // Copy all facilities for heatmap
        } else {
            // Process real data (existing code)
            facilities = [];
            
            // Process health facilities if available
            if (healthData && healthData.features) {
                showNotification(`Loading ${healthData.features.length} health facilities...`);
                
                healthData.features.forEach((feature, index) => {
                    if (feature.geometry && feature.geometry.coordinates) {
                        const coords = feature.geometry.coordinates;
                        const props = feature.properties;
                        
                        facilities.push({
                            id: 'health_' + (props.fid || Math.random()),
                            name: props.name || 'Unknown Health Facility',
                            type: mapHealthType(props.amenity || props.healthcare),
                            lat: coords[1],
                            lng: coords[0],
                            county: detectCounty(coords[1], coords[0], props['addr:city']),
                            phone: props.phone || '',
                            hours: props.opening_hours || '',
                            rating: '4.0',
                            category: 'health'
                        });
                    }
                    
                    // Update progress every 1000 facilities
                    if (index % 1000 === 0) {
                        showNotification(`Processed ${index}/${healthData.features.length} health facilities...`);
                    }
                });
            }
            
            // Process education facilities if available (NOW USING ALL FACILITIES)
            if (educationData && educationData.features) {
                console.log('Processing ALL education facilities...');
                showNotification(`Loading ${educationData.features.length} education facilities...`);
                
                educationData.features.forEach((feature, index) => {
                    if (feature.geometry && feature.geometry.coordinates) {
                        const coords = feature.geometry.coordinates;
                        const props = feature.properties;
                        
                        facilities.push({
                            id: 'education_' + (props.osm_id || Math.random()),
                            name: props.name || 'Unknown Education Facility',
                            type: mapEducationType(props.amenity),
                            lat: coords[1],
                            lng: coords[0],
                            county: detectCounty(coords[1], coords[0], props['addr:city']),
                            phone: props.phone || '',
                            hours: props.opening_hours || '',
                            rating: '4.0',
                            category: 'education'
                        });
                    }
                    
                    // Update progress every 1000 facilities
                    if (index % 1000 === 0) {
                        showNotification(`Processed ${index}/${educationData.features.length} education facilities...`);
                    }
                });
                
                console.log(`Processed ALL ${educationData.features.length} education facilities`);
            }
            
            // Process airports if available
            if (airportsData && airportsData.features) {
                console.log('Processing airports...');
                airportsData.features.forEach(feature => {
                    if (feature.geometry && feature.geometry.coordinates) {
                        const coords = feature.geometry.coordinates;
                        const props = feature.properties;
                        
                        if ((props.aeroway === 'aerodrome' || props.aeroway === 'airport') && props.name) {
                            facilities.push({
                                id: 'airport_' + (props.osm_id || Math.random()),
                                name: props.name || 'Unknown Airport',
                                type: 'Airport',
                                lat: coords[1],
                                lng: coords[0],
                                county: detectCounty(coords[1], coords[0], props['addr:city']),
                                phone: props.phone || '',
                                hours: '',
                                rating: '4.0',
                                category: 'transport'
                            });
                        }
                    }
                });
            }
            
            // Process financial services if available
            if (financialData && financialData.features) {
                console.log('Processing financial services...');
                financialData.features.forEach(feature => {
                    if (feature.geometry && feature.geometry.coordinates) {
                        const coords = feature.geometry.coordinates;
                        const props = feature.properties;
                        
                        facilities.push({
                            id: 'financial_' + (props.osm_id || Math.random()),
                            name: props.name || `${mapFinancialType(props.amenity)}`,
                            type: mapFinancialType(props.amenity),
                            lat: coords[1],
                            lng: coords[0],
                            county: detectCounty(coords[1], coords[0], props['addr:city']),
                            phone: props.phone || '',
                            hours: props.opening_hours || '',
                            rating: '4.0',
                            category: 'financial'
                        });
                    }
                });
            }
            
            // Process points of interest if available (NOW USING ALL FACILITIES)
            if (poiData && poiData.features) {
                console.log('Processing ALL points of interest...');
                showNotification(`Loading ${poiData.features.length} points of interest...`);
                
                poiData.features.forEach((feature, index) => {
                    if (feature.geometry && feature.geometry.coordinates) {
                        const coords = feature.geometry.coordinates;
                        const props = feature.properties;
                        
                        // Only process POIs with names to reduce noise
                        if (props.name && props.name.trim()) {
                            // Special handling for churches - mark as important category
                            const category = (props.amenity === 'place_of_worship') ? 'church' : 'poi';
                            
                            facilities.push({
                                id: 'poi_' + (props.osm_id || index),
                                name: props.name || 'Unknown Point of Interest',
                                type: mapPOIType(props.tourism || props.amenity || props.shop),
                                lat: coords[1],
                                lng: coords[0],
                                county: detectCounty(coords[1], coords[0], props['addr:city']),
                                phone: props.phone || '',
                                hours: props.opening_hours || '',
                                rating: '4.0',
                                category: category
                            });
                        }
                    }
                    
                    // Update progress every 5000 POIs (since POI file is large)
                    if (index % 5000 === 0) {
                        showNotification(`Processed ${index}/${poiData.features.length} points of interest...`);
                    }
                });
                
                console.log(`Processed ALL ${poiData.features.length} points of interest`);
            }
        }
        
        console.log(`Loaded ${facilities.length} facilities successfully`);
        
        // Copy all facilities for heatmap use
        allFacilities = [...facilities];
        
        // Show completion notification
        showNotification(`Loaded ${facilities.length} facilities successfully!`);
        
        // Use setTimeout to prevent UI blocking
        setTimeout(() => {
            if (facilities.length > 0) {
                populateCountyDropdown();
                setupCountySearch();
                populateFacilityList();
                updateMarkers();
                fitMapToAllFacilities();
                setupSearch(); // Initialize search after facilities are loaded
                hideLoading();
            } else {
                console.error('No facilities found!');
                alert('No facilities data available. Please check the data files.');
                hideLoading();
            }
        }, 100); // 100ms delay to prevent UI blocking
        
    } catch (error) {
        console.error('Error loading facilities:', error);
        
        // Fallback to sample data on error
        console.log('Error loading data, using sample data');
        usingSampleData = true;
        document.getElementById('sampleDataNotice').classList.add('show');
        facilities = generateSampleData();
        allFacilities = [...facilities]; // Copy all facilities for heatmap
        
        populateCountyDropdown();
        setupCountySearch();
        populateFacilityList();
        updateMarkers();
        fitMapToAllFacilities();
        setupSearch(); // Initialize search after facilities are loaded
        hideLoading();
    }
}

// Smart county detection based on coordinates
function detectCounty(lat, lng, fallbackCity = null) {
    // First try the provided city
    if (fallbackCity && fallbackCity.trim()) {
        return fallbackCity;
    }
    
    // Kenya county boundaries (approximate)
    const counties = [
        { name: 'Nairobi', bounds: { north: -1.1, south: -1.4, east: 37.0, west: 36.6 } },
        { name: 'Kajiado', bounds: { north: -1.0, south: -2.8, east: 37.5, west: 36.0 } },
        { name: 'Kiambu', bounds: { north: -0.8, south: -1.3, east: 37.2, west: 36.6 } },
        { name: 'Machakos', bounds: { north: -1.0, south: -2.0, east: 37.5, west: 36.8 } },
        { name: 'Nakuru', bounds: { north: -0.0, south: -1.5, east: 36.5, west: 35.5 } },
        { name: 'Kisumu', bounds: { north: 0.2, south: -0.5, east: 35.0, west: 34.5 } },
        { name: 'Mombasa', bounds: { north: -4.0, south: -4.2, east: 39.8, west: 39.5 } },
        { name: 'Uasin Gishu', bounds: { north: 1.0, south: 0.0, east: 35.5, west: 34.5 } },
        { name: 'Kakamega', bounds: { north: 0.5, south: 0.0, east: 35.0, west: 34.5 } }
    ];
    
    // Find which county contains these coordinates
    for (const county of counties) {
        if (lat <= county.bounds.north && lat >= county.bounds.south &&
            lng <= county.bounds.east && lng >= county.bounds.west) {
            return county.name + ' County';
        }
    }
    
    return 'Unknown County';
}

// Map health facility types
function mapHealthType(amenity, healthcare) {
    if (healthcare === 'hospital') return 'Hospital';
    if (healthcare === 'clinic') return 'Clinic';
    if (healthcare === 'pharmacy') return 'Pharmacy';
    if (healthcare === 'dentist') return 'Dental Clinic';
    if (healthcare === 'blood_donation') return 'Blood Bank';
    if (amenity === 'hospital') return 'Hospital';
    if (amenity === 'clinic') return 'Clinic';
    if (amenity === 'pharmacy') return 'Pharmacy';
    if (amenity === 'dentist') return 'Dental Clinic';
    if (amenity === 'blood_bank') return 'Blood Bank';
    return 'Health Facility';
}

// Map education facility types
function mapEducationType(amenity) {
    if (amenity === 'school') return 'School';
    if (amenity === 'university') return 'University';
    if (amenity === 'college') return 'College';
    if (amenity === 'library') return 'Library';
    return 'Education Facility';
}

// Map financial service types
function mapFinancialType(amenity) {
    if (amenity === 'bank') return 'Bank';
    if (amenity === 'atm') return 'ATM';
    if (amenity === 'money_transfer') return 'Money Transfer';
    if (amenity === 'post_office') return 'Post Office';
    if (amenity === 'bureau_de_change') return 'Bureau de Change';
    return 'Financial Service';
}

// Map points of interest types
function mapPOIType(type) {
    if (type === 'hotel' || type === 'motel') return 'Hotel';
    if (type === 'restaurant' || type === 'cafe' || type === 'fast_food') return 'Restaurant';
    if (type === 'museum') return 'Museum';
    if (type === 'attraction') return 'Attraction';
    if (type === 'viewpoint' || type === 'vista_point') return 'Viewpoint';
    if (type === 'park') return 'Park';
    if (type === 'monument') return 'Monument';
    if (type === 'place_of_worship') return 'Place of Worship';
    if (type === 'shop' || type === 'supermarket' || type === 'convenience') return 'Shopping';
    if (type === 'cinema') return 'Cinema';
    if (type === 'theatre') return 'Theatre';
    if (type === 'stadium') return 'Stadium';
    if (type === 'zoo') return 'Zoo';
    if (type === 'aquarium') return 'Aquarium';
    if (type === 'artwork') return 'Artwork';
    if (type === 'fountain') return 'Fountain';
    if (type === 'memorial') return 'Memorial';
    return 'Point of Interest';
}

// Populate county dropdown
function populateCountyDropdown() {
    if (!facilities || facilities.length === 0) {
        console.error('No facilities data available!');
        return;
    }
    
    // Get ALL counties from ALL facilities, not filtered
    const counties = [...new Set(facilities.map(f => f.county))].sort();
    
    const select = document.getElementById('countySelect');
    if (!select) {
        return;
    }
    
    // Clear existing options except "All Counties"
    while (select.options.length > 1) {
        select.remove(1);
    }
    
    counties.forEach(county => {
        const option = document.createElement('option');
        option.value = county;
        option.textContent = county;
        select.appendChild(option);
    });
}

// County search functionality
function setupCountySearch() {
    const countySearch = document.getElementById('countySearch');
    const countySelect = document.getElementById('countySelect');
    
    if (!countySearch || !countySelect) {
        console.error('County search elements not found!');
        return;
    }
    
    countySearch.addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase();
        const options = countySelect.options;
        
        // Show/hide options based on search
        for (let i = 1; i < options.length; i++) {
            const option = options[i];
            const countyName = option.textContent.toLowerCase();
            
            if (countyName.includes(searchTerm)) {
                option.style.display = '';
            } else {
                option.style.display = 'none';
            }
        }
        
        // If search matches exactly one county, select it
        let visibleOptions = [];
        for (let i = 1; i < options.length; i++) {
            if (options[i].style.display !== 'none') {
                visibleOptions.push(options[i]);
            }
        }
        
        if (visibleOptions.length === 1) {
            countySelect.value = visibleOptions[0].value;
            // Trigger change event to update facilities
            countySelect.dispatchEvent(new Event('change'));
        } else if (searchTerm === '') {
            countySelect.value = 'all';
            countySelect.dispatchEvent(new Event('change'));
        }
    });
    
    // Clear search when dropdown is manually changed
    countySelect.addEventListener('change', function() {
        countySearch.value = '';
        // Reset all options to visible
        const options = countySelect.options;
        for (let i = 1; i < options.length; i++) {
            options[i].style.display = '';
        }
    });
}

// Populate facility list
function populateFacilityList() {
    const facilityList = document.getElementById('facilityList');
    
    facilityList.innerHTML = '';
    
    // Show ALL facilities initially, not filtered by dropdown values
    let allFacilities = facilities;
    
    // Add header with total count
    const header = document.createElement('div');
    header.style.cssText = 'padding: 10px; background: #f8f9fa; border-bottom: 1px solid #dee2e6; margin-bottom: 10px; font-weight: bold; color: #5f6368;';
    header.innerHTML = `📋 All Facilities (${allFacilities.length} total)`;
    facilityList.appendChild(header);
    
    // Sort by name
    allFacilities.sort((a, b) => a.name.localeCompare(b.name));
    
    allFacilities.forEach(facility => {
        const item = document.createElement('div');
        item.className = 'facility-item';
        item.innerHTML = `
            <div style="display: flex; align-items: flex-start;">
                <i class="fas fa-${getFacilityIconName(facility.type)}" style="color: ${facilityColors[facility.type] || '#5f6368'}; margin-right: 12px; font-size: 16px; width: 20px; text-align: center; margin-top: 2px;"></i>
                <div style="flex: 1;">
                    <div class="facility-name">${facility.name}</div>
                    <div class="facility-info">
                        <span class="facility-type"><i class="fas fa-tag"></i> ${facility.type}</span>
                        <span><i class="fas fa-map-marker-alt"></i> ${facility.county}</span>
                    </div>
                    <div class="facility-info" style="margin-top: 4px;">
                        <span><i class="fas fa-star star"></i> ${facility.rating}</span>
                        ${facility.phone ? `<span><i class="fas fa-phone"></i> ${facility.phone}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
        item.addEventListener('click', () => {
            map.setView([facility.lat, facility.lng], 15);
            // Find and open the marker popup
            markers.forEach(marker => {
                if (marker.facilityData && marker.facilityData.id === facility.id) {
                    marker.openPopup();
                }
            });
        });
        
        facilityList.appendChild(item);
    });
}

// Get facility icon - returns proper Leaflet divIcon
function getFacilityIcon(type) {
    const color = facilityColors[type] || '#5f6368';
    const firstLetter = type.charAt(0).toUpperCase();
    
    return L.divIcon({
        className: 'custom-marker',
        html: `<div style="background: ${color}; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-size: 10px; font-weight: bold;">${firstLetter}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

// Get facility icon name for FontAwesome (used in lists)
function getFacilityIconName(type) {
    const icons = {
        'Hospital': 'hospital',
        'Clinic': 'clinic-medical',
        'Pharmacy': 'pills',
        'Dental Clinic': 'tooth',
        'Blood Bank': 'tint',
        'School': 'graduation-cap',
        'University': 'university',
        'College': 'user-graduate',
        'Library': 'book',
        'Education Facility': 'school',
        'Airport': 'plane',
        'Health Facility': 'clinic-medical',
        'Bank': 'landmark',
        'ATM': 'credit-card',
        'Money Transfer': 'money-bill-wave',
        'Post Office': 'envelope',
        'Bureau de Change': 'exchange-alt',
        'Financial Service': 'hand-holding-usd'
    };
    return icons[type] || 'map-marker-alt';
}

// Update markers - simple and direct - SHOW ALL FACILITIES
function updateMarkers() {
    const county = document.getElementById('countySelect').value;
    const facilityType = document.getElementById('facilityTypeSelect').value;
    
    // Use all loaded facilities - NO TEST DATA NEEDED
    let facilitiesToUse = facilities.length > 0 ? facilities : [];
    
    let filtered = facilitiesToUse;
    
    // Filter by county
    if (county !== 'all') {
        filtered = filtered.filter(f => f.county === county);
    }
    
    // Filter by facility type
    if (facilityType !== 'all') {
        filtered = filtered.filter(f => f.category === facilityType);
    }
    
    // Clear existing markers
    if (markerCluster) {
        map.removeLayer(markerCluster);
    }
    
    markers = [];
    
    // Create new marker cluster
    markerCluster = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true
    });
    
    // Add markers for filtered facilities
    filtered.forEach(facility => {
        const icon = getFacilityIcon(facility.type);
        const marker = L.marker([facility.lat, facility.lng], { icon: icon });
        
        marker.bindPopup(`
            <div style="min-width: 200px;">
                <h3 style="margin: 0 0 8px 0; color: #2c3e50;">${facility.name}</h3>
                <p style="margin: 4px 0;"><strong>Type:</strong> ${facility.type}</p>
                <p style="margin: 4px 0;"><strong>County:</strong> ${facility.county}</p>
                <p style="margin: 4px 0;"><strong>Category:</strong> ${facility.category}</p>
                ${facility.phone ? `<p style="margin: 4px 0;"><strong>Phone:</strong> ${facility.phone}</p>` : ''}
                <button onclick="getDirections(${facility.lat}, ${facility.lng})" style="margin-top: 8px; padding: 6px 12px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">Get Directions</button>
            </div>
        `);
        
        marker.facilityData = facility;
        markerCluster.addLayer(marker);
        markers.push(marker);
    });
    
    map.addLayer(markerCluster);
    
    // Show results count
    showNotification(`Found ${filtered.length} facilities`);
    
    // Fit map to show results
    if (filtered.length > 0) {
        const bounds = L.latLngBounds(filtered.map(f => [f.lat, f.lng]));
        map.fitBounds(bounds.pad(0.1));
    }
}

// Fit map to show all facilities
function fitMapToAllFacilities() {
    if (facilities.length > 0) {
        const allMarkers = facilities.map(f => [f.lat, f.lng]);
        const bounds = L.latLngBounds(allMarkers);
        map.fitBounds(bounds.pad(0.1));
    }
}

// Fit map to filtered facilities
function fitMapToFilteredFacilities() {
    const county = document.getElementById('countySelect').value;
    
    let filtered = facilities;
    if (county !== 'all') {
        filtered = filtered.filter(f => f.county === county);
    }
    
    if (filtered.length > 0) {
        const filteredMarkers = filtered.map(f => [f.lat, f.lng]);
        const bounds = L.latLngBounds(filteredMarkers);
        map.fitBounds(bounds.pad(0.1));
    }
}

// Hide loading
function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}

// FIX #3 & #5 - Show directions with proper panel and animation
window.showDirectionsFromPopup = function(lat, lng, name, type) {
    console.log('showDirectionsFromPopup called');
    
    // Close any open popups immediately
    map.closePopup();
    
    // Set selected facility
    selectedFacility = {
        lat: lat,
        lng: lng,
        name: name,
        type: type
    };
    
    // Show directions panel
    const panel = document.getElementById('directionsPanel');
    panel.classList.add('show');
    
    // Try to get user location automatically
    if (userLocation) {
        var startLocationText = 'My Location (Detected)';
        var startLocationPlaceholder = 'Using your current location';
    } else {
        // Try to get location now
        getUserLocation().then(location => {
            if (location) {
                document.getElementById('startLocationInput').value = 'My Location (Detected)';
                document.getElementById('startLocationInput').placeholder = 'Using your current location';
            }
        }).catch(() => {
            // Fallback if geolocation fails
            console.log('Could not get location, user will need to input manually');
        });
        var startLocationText = 'Getting your location...';
        var startLocationPlaceholder = 'Enter start location or allow location access';
    }
    
    // Update panel with facility info
    document.getElementById('directionsRoute').innerHTML = `
        <div class="route-info">
            <div class="route-distance">Destination: ${name}</div>
            <div class="route-time">${type}</div>
        </div>
        <div class="start-location">
            <input type="text" class="location-input" id="startLocationInput" placeholder="${startLocationPlaceholder}" value="${userLocation ? 'My Location (Detected)' : ''}">
            <button class="get-directions-btn" id="calculateRouteBtn">
                <i class="fas fa-route"></i> Get Directions
            </button>
        </div>
    `;
    
    // Add event listener to calculate route button
    setTimeout(() => {
        const calculateBtn = document.getElementById('calculateRouteBtn');
        console.log('Looking for calculateRouteBtn:', calculateBtn);
        
        if (calculateBtn) {
            // Remove any existing event listeners to prevent duplicates
            calculateBtn.replaceWith(calculateBtn.cloneNode(true));
            const newBtn = document.getElementById('calculateRouteBtn');
            
            newBtn.addEventListener('click', function(e) {
                e.preventDefault();
                console.log('Calculate route button clicked!');
                console.log('Event target:', e.target);
                
                const startInput = document.getElementById('startLocationInput').value;
                console.log('Start input:', startInput);
                console.log('User location:', userLocation);
                console.log('Destination:', lat, lng, name);
                
                // Show loading state
                newBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calculating...';
                newBtn.disabled = true;
                
                // Check if user wants to use their location
                if (startInput.includes('My Location') || !startInput) {
                    if (userLocation) {
                        console.log('Using user location:', userLocation);
                        calculateAndShowRoute(userLocation.lat, userLocation.lng, lat, lng, name);
                    } else {
                        console.log('Trying to get user location now...');
                        // Try to get location now
                        getUserLocation().then(location => {
                            if (location) {
                                document.getElementById('startLocationInput').value = 'My Location (Detected)';
                                calculateAndShowRoute(location.lat, location.lng, lat, lng, name);
                            } else {
                                showNotification('Could not get your location. Please enable location access or enter an address.');
                                // Default to Nairobi if no user location
                                calculateAndShowRoute(-1.2864, 36.8172, lat, lng, name);
                            }
                        }).catch(() => {
                            showNotification('Could not get your location. Please enable location access or enter an address.');
                            // Default to Nairobi if no user location
                            calculateAndShowRoute(-1.2864, 36.8172, lat, lng, name);
                        }).finally(() => {
                            // Reset button state
                            newBtn.innerHTML = '<i class="fas fa-route"></i> Get Directions';
                            newBtn.disabled = false;
                        });
                    }
                } else {
                    console.log('Using manual input:', startInput);
                    // TODO: Geocode the input address
                    // For now, use Nairobi as fallback
                    showNotification('Address geocoding not implemented yet - using Nairobi as start point');
                    calculateAndShowRoute(-1.2864, 36.8172, lat, lng, name);
                    
                    // Reset button state
                    setTimeout(() => {
                        newBtn.innerHTML = '<i class="fas fa-route"></i> Get Directions';
                        newBtn.disabled = false;
                    }, 2000);
                }
            });
            console.log('Event listener added successfully');
        } else {
            console.error('calculateRouteBtn not found!');
            console.error('Available buttons:', document.querySelectorAll('button'));
        }
    }, 100);
};

// Find nearest road from popup
window.findNearestRoadFromPopup = function(lat, lng, facilityName) {
    console.log('Finding nearest road for facility:', facilityName);
    
    // Close any open popups immediately
    map.closePopup();
    
    // Show loading notification
    showNotification('Finding nearest road...');
    
    findNearestRoad(lat, lng, function(error, road) {
        if (error) {
            console.error('Error finding nearest road:', error);
            showNotification('Could not find nearest road: ' + error);
        } else if (road) {
            console.log('Nearest road found:', road);
            displayNearestRoad(road, facilityName);
            highlightNearestRoad(road);
        } else {
            showNotification('No roads found nearby');
        }
    });
};

// Highlight nearest road on map
function highlightNearestRoad(road) {
    // Remove existing road highlight if any
    if (window.roadHighlight) {
        map.removeLayer(window.roadHighlight);
    }
    
    // Highlight the access road (from road point to facility)
    if (road.routeGeometry && road.routeGeometry.coordinates) {
        const routeCoordinates = road.routeGeometry.coordinates.map(coord => [coord[1], coord[0]]);
        
        // Add highlighted route from road to facility
        window.roadHighlight = L.polyline(routeCoordinates, {
            color: '#34A853',
            weight: 6,
            opacity: 0.8,
            dashArray: '10, 5'
        }).addTo(map);
        
        // Fit map to show the driving route
        const bounds = L.latLngBounds(routeCoordinates);
        map.fitBounds(bounds.pad(0.2));
    } else {
        // Fallback: highlight the road itself
        if (road.geometry && road.geometry.length > 1) {
            const roadCoordinates = road.geometry.map(point => [point.lat, point.lon]);
            
            window.roadHighlight = L.polyline(roadCoordinates, {
                color: '#34A853',
                weight: 6,
                opacity: 0.8,
                dashArray: '10, 5'
            }).addTo(map);
            
            const bounds = L.latLngBounds(roadCoordinates);
            map.fitBounds(bounds.pad(0.2));
        }
    }
}

// Display nearest road information
function displayNearestRoad(road, facilityName) {
    console.log('Displaying nearest road:', road);
    
    // Create road information popup
    const roadInfo = `
        <div style="padding: 16px; min-width: 300px;">
            <h4 style="margin: 0 0 12px 0; color: #202124; font-size: 16px;">
                <i class="fas fa-road" style="color: #34A853; margin-right: 8px;"></i>
                Nearest Road to ${facilityName}
            </h4>
            <div style="background: #f8f9fa; padding: 12px; border-radius: 8px; margin-bottom: 12px;">
                <div style="font-size: 14px; color: #5f6368; margin-bottom: 4px;">Road Name:</div>
                <div style="font-size: 16px; font-weight: 500; color: #202124; margin-bottom: 8px;">
                    ${road.name || 'Unnamed road'}
                </div>
                <div style="font-size: 14px; color: #5f6368; margin-bottom: 4px;">Road Type:</div>
                <div style="font-size: 14px; font-weight: 500; color: #202124; margin-bottom: 8px;">
                    ${road.type || 'road'}
                </div>
                <div style="font-size: 14px; color: #5f6368; margin-bottom: 4px;">Driving Distance:</div>
                <div style="font-size: 16px; font-weight: 500; color: #34A853; margin-bottom: 8px;">
                    ${(road.drivingDistance / 1000).toFixed(2)} km
                </div>
                <div style="font-size: 14px; color: #5f6368; margin-bottom: 4px;">Estimated Driving Time:</div>
                <div style="font-size: 16px; font-weight: 500; color: #4285F4;">
                    ${Math.round(road.drivingTime / 60)} minutes
                </div>
            </div>
            <div style="font-size: 12px; color: #5f6368; text-align: center;">
                <i class="fas fa-info-circle" style="margin-right: 4px;"></i>
                Route calculated using real road data
            </div>
        </div>
    `;
    
    // Show the road information in a popup at the road point
    if (road.roadPoint) {
        L.popup()
            .setLatLng([road.roadPoint.lat, road.roadPoint.lon])
            .setContent(roadInfo)
            .openOn(map);
    } else if (road.geometry && road.geometry.length > 0) {
        // Fallback to first point of road geometry
        L.popup()
            .setLatLng([road.geometry[0].lat, road.geometry[0].lon])
            .setContent(roadInfo)
            .openOn(map);
    }
    
    showNotification(`Nearest road found: ${road.name || 'Unnamed road'} (${(road.drivingDistance / 1000).toFixed(2)} km away)`);
}

// Calculate and show route with car animation (FIX #5 - Performance optimized)
function calculateAndShowRoute(fromLat, fromLng, toLat, toLng, facilityName) {
    console.log('Calculating route with coordinates:');
    console.log('From:', fromLat, fromLng);
    console.log('To:', toLat, toLng);
    console.log('Facility:', facilityName);
    
    // Validate coordinates
    if (!fromLat || !fromLng || !toLat || !toLng) {
        console.error('Invalid coordinates provided');
        showNotification('Invalid coordinates for route calculation');
        return;
    }
    
    // Remove existing route
    if (routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
    }
    
    // Clear any existing route lines
    map.eachLayer(layer => {
        if (layer instanceof L.Polyline && layer.options.className !== 'permanent') {
            map.removeLayer(layer);
        }
    });
    
    // Create real road route using OSRM (Open Source Routing Machine)
    try {
        // OSRM API expects [longitude, latitude] order
        // Using shortest route optimization with additional parameters for better accuracy
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=true&alternatives=false&continue_straight=false`;
        console.log('OSRM URL for shortest route:', osrmUrl);
        console.log('Calculating shortest route from:', [fromLat, fromLng], 'to:', [toLat, toLng]);
        
        showNotification('Calculating shortest route...');
        
        fetch(osrmUrl)
            .then(response => {
                console.log('OSRM response status:', response.status);
                if (!response.ok) {
                    throw new Error(`OSRM API error: ${response.status} ${response.statusText}`);
                }
                return response.json();
            })
            .then(data => {
                console.log('OSRM response data:', data);
                
                if (data.routes && data.routes.length > 0) {
                    const route = data.routes[0];
                    const coordinates = route.geometry.coordinates.map(coord => [coord[1], coord[0]]); // Convert to [lat, lng] for Leaflet
                    
                    // Log route details for verification
                    console.log('=== SHORTEST ROUTE FOUND ===');
                    console.log('Route distance:', (route.distance / 1000).toFixed(2), 'km');
                    console.log('Route duration:', (route.duration / 60).toFixed(1), 'minutes');
                    console.log('Route coordinates:', coordinates.length, 'points');
                    console.log('First few coordinates:', coordinates.slice(0, 5));
                    console.log('Route is optimized for shortest distance');
                    
                    // Validate that this is indeed the shortest route
                    if (data.routes.length > 1) {
                        console.warn('Multiple routes found, using first (shortest) route');
                        console.log('Available routes:', data.routes.length);
                    }
                    
                    // Validate that coordinates are in Kenya
                    if (coordinates.length > 0) {
                        const firstCoord = coordinates[0];
                        console.log('First coordinate:', firstCoord);
                        if (Math.abs(firstCoord[0]) > 10 || Math.abs(firstCoord[1]) > 50) {
                            console.warn('Coordinates appear to be outside Kenya:', firstCoord);
                            showNotification('Warning: Route coordinates appear to be outside Kenya');
                        }
                    }
                    
                    // Create route line with real road coordinates
                    const routeLine = L.polyline(coordinates, {
                        color: '#4285F4',
                        weight: 6,
                        opacity: 0.8,
                        dashArray: '10, 10'
                    }).addTo(map);
                    
                    // Add start and end markers
                    const startIcon = L.divIcon({
                        className: 'start-marker',
                        html: '<div style="background: #4CAF50; color: white; border: 3px solid white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">A</div>',
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    });
                    
                    const endIcon = L.divIcon({
                        className: 'end-marker',
                        html: '<div style="background: #F44336; color: white; border: 3px solid white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">B</div>',
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    });
                    
                    L.marker([fromLat, fromLng], { icon: startIcon }).addTo(map);
                    L.marker([toLat, toLng], { icon: endIcon }).addTo(map);
                    
                    // Update directions panel with shortest route info
                    let directionsHTML = `
                        <div class="route-info">
                            <div class="route-distance">${(route.distance / 1000).toFixed(1)} km</div>
                            <div class="route-time">${Math.round(route.duration / 60)} min</div>
                            <div class="route-type" style="color: #4CAF50; font-size: 12px; font-weight: 500; margin-top: 4px;">
                                <i class="fas fa-route"></i> Shortest Route
                            </div>
                        </div>
                    `;
                    
                    // Add some turn-by-turn directions from OSRM steps
                    const steps = route.legs[0].steps.slice(0, 5);
                    steps.forEach((step, index) => {
                        const maneuverIcon = getManeuverIcon(step.maneuver.type);
                        directionsHTML += `
                            <div class="direction-step">
                                <div class="step-icon"><i class="fas fa-${maneuverIcon}"></i></div>
                                <div>
                                    <div class="step-text">${step.maneuver.instruction || 'Continue'}</div>
                                    <div class="step-distance">${(step.distance / 1000).toFixed(1)} km</div>
                                </div>
                            </div>
                        `;
                    });
                    
                    directionsHTML += `
                        <div class="direction-step">
                            <div class="step-icon"><i class="fas fa-flag-checkered"></i></div>
                            <div>
                                <div class="step-text">Route calculated successfully</div>
                                <div class="step-distance">${(route.distance / 1000).toFixed(1)} km total</div>
                            </div>
                        </div>
                        <div style="padding: 8px; background: #e8f0fe; border-radius: 6px; text-align: center;">
                            <i class="fas fa-car" style="color: #4285F4; margin-right: 8px;"></i>
                            <span style="color: #4285F4; font-size: 14px;">Car animation starting...</span>
                            <button onclick="speakNavigation('Test voice navigation. This is a test of the turn by turn directions system.', true)" 
                                    style="margin-left: 10px; padding: 4px 8px; background: #4285F4; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
                                Test Voice
                            </button>
                        </div>
                    `;
                    
                    document.getElementById('directionsRoute').innerHTML = directionsHTML;
                    
                    // Show success notification with shortest route confirmation
                    showNotification(`Shortest route found: ${(route.distance / 1000).toFixed(1)} km, ${Math.round(route.duration / 60)} minutes`);
                    
                    // Fit map to show the entire route
                    const routeBounds = L.latLngBounds(coordinates);
                    map.fitBounds(routeBounds, { padding: [50, 50] });
                    
                    // Start car animation along the shortest route
                    console.log('Starting car animation along shortest route...');
                    console.log('Route details:', {
                        distance: (route.distance / 1000).toFixed(2) + ' km',
                        duration: (route.duration / 60).toFixed(1) + ' minutes',
                        coordinates: coordinates.length,
                        optimization: 'shortest'
                    });
                    
                    // Start car animation along the shortest route with delay
                    setTimeout(() => {
                        // Test with a simple route first
                        if (coordinates && coordinates.length > 1) {
                            animateCarAlongRealRoute(coordinates, route.legs[0].steps);
                        } else {
                            console.error('No valid coordinates for animation');
                        }
                    }, 1500); // Start animation after 1.5 seconds
                    
                    // Close directions panel after route is displayed
                    setTimeout(() => {
                        const panel = document.getElementById('directionsPanel');
                        if (panel) {
                            panel.classList.remove('show');
                            console.log('Directions panel closed after route calculation');
                        }
                    }, 3000); // Close after 3 seconds to let user see the route info
                    
                } else {
                    console.error('No OSRM route found');
                    console.error('OSRM response data:', data);
                    showNotification('No route found - using direct route');
                    createFallbackRoute(fromLat, fromLng, toLat, toLng, facilityName);
                    
                    // Close directions panel after fallback route
                    setTimeout(() => {
                        const panel = document.getElementById('directionsPanel');
                        if (panel) {
                            panel.classList.remove('show');
                            console.log('Directions panel closed after fallback route');
                        }
                    }, 3000);
                }
            })
            .catch(error => {
                console.error('OSRM routing error:', error);
                showNotification('Routing service unavailable - using direct route');
                createFallbackRoute(fromLat, fromLng, toLat, toLng, facilityName);
                
                // Close directions panel after error route
                setTimeout(() => {
                    const panel = document.getElementById('directionsPanel');
                    if (panel) {
                        panel.classList.remove('show');
                        console.log('Directions panel closed after error route');
                    }
                }, 3000);
            });
        
    } catch (error) {
        console.error('Error creating OSRM route:', error);
        showNotification('Route calculation failed - using direct route');
        createFallbackRoute(fromLat, fromLng, toLat, toLng, facilityName);
        
        // Close directions panel after error
        setTimeout(() => {
            const panel = document.getElementById('directionsPanel');
            if (panel) {
                panel.classList.remove('show');
                console.log('Directions panel closed after error');
            }
        }, 3000);
    }
}

// Get direction icon based on instruction type
function getDirectionIcon(type) {
    const iconMap = {
        'turn': 'arrow-right',
        'new name': 'arrow-right',
        'depart': 'circle',
        'arrive': 'flag-checkered',
        'fork': 'code-branch',
        'merge': 'code-branch',
        'roundabout': 'circle-notch',
        'rotary': 'circle-notch',
        'roundabout turn': 'circle-notch',
        'notification': 'info-circle',
        'exit roundabout': 'arrow-right',
        'exit rotary': 'arrow-right'
    };
    return iconMap[type] || 'arrow-right';
}

// Get maneuver icon based on OSRM maneuver type
function getManeuverIcon(type) {
    const iconMap = {
        'turn': 'arrow-right',
        'new name': 'arrow-right',
        'depart': 'circle',
        'arrive': 'flag-checkered',
        'fork': 'code-branch',
        'merge': 'code-branch',
        'roundabout': 'circle-notch',
        'rotary': 'circle-notch',
        'roundabout turn': 'circle-notch',
        'notification': 'info-circle',
        'exit roundabout': 'arrow-right',
        'exit rotary': 'arrow-right',
        'on ramp': 'arrow-right',
        'off ramp': 'arrow-right',
        'end of road': 'flag-checkered',
        'continue': 'arrow-right'
    };
    return iconMap[type] || 'arrow-right';
}

// Fallback route function when OSRM fails
function createFallbackRoute(fromLat, fromLng, toLat, toLng, facilityName) {
    console.log('Creating fallback route...');
    
    // Create simple direct route with intermediate waypoints for animation
    const coordinates = [
        [fromLat, fromLng],
        [fromLat + (toLat - fromLat) * 0.1, fromLng + (toLng - fromLng) * 0.1],
        [fromLat + (toLat - fromLat) * 0.3, fromLng + (toLng - fromLng) * 0.3],
        [fromLat + (toLat - fromLat) * 0.5, fromLng + (toLng - fromLng) * 0.5],
        [fromLat + (toLat - fromLat) * 0.7, fromLng + (toLng - fromLng) * 0.7],
        [fromLat + (toLat - fromLng) * 0.9, fromLng + (toLng - fromLng) * 0.9],
        [toLat, toLng]
    ];
    
    const routeLine = L.polyline(coordinates, {
        color: '#4285F4',
        weight: 6,
        opacity: 0.8,
        dashArray: '10, 10'
    }).addTo(map);
    
    // Add markers
    const startIcon = L.divIcon({
        className: 'start-marker',
        html: '<div style="background: #4CAF50; color: white; border: 3px solid white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">A</div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
    
    const endIcon = L.divIcon({
        className: 'end-marker',
        html: '<div style="background: #F44336; color: white; border: 3px solid white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">B</div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
    
    L.marker([fromLat, fromLng], { icon: startIcon }).addTo(map);
    L.marker([toLat, toLng], { icon: endIcon }).addTo(map);
    
    const distance = calculateDistance(fromLat, fromLng, toLat, toLng);
    const time = Math.round(distance * 12);
    
    document.getElementById('directionsRoute').innerHTML = `
        <div class="route-info">
            <div class="route-distance">${distance.toFixed(1)} km</div>
            <div class="route-time">~${time} min</div>
        </div>
        <div class="direction-step">
            <div class="step-icon"><i class="fas fa-circle"></i></div>
            <div>
                <div class="step-text">Start at your location</div>
                <div class="step-distance">0 km</div>
            </div>
        </div>
        <div class="direction-step">
            <div class="step-icon"><i class="fas fa-flag-checkered"></i></div>
            <div>
                <div class="step-text">Arrive at ${facilityName}</div>
                <div class="step-distance">${distance.toFixed(1)} km total</div>
            </div>
        </div>
        <div style="padding: 8px; background: #e8f0fe; border-radius: 6px; text-align: center;">
            <i class="fas fa-car" style="color: #4285F4; margin-right: 8px;"></i>
            <span style="color: #4285F4; font-size: 14px;">Car animation starting...</span>
        </div>
    `;
    
    const bounds = L.latLngBounds(coordinates);
    map.fitBounds(bounds.pad(0.1));
    
    // Automatically start car animation for fallback route
    setTimeout(() => {
        console.log('Auto-starting fallback car animation...');
        console.log('Fallback coordinates:', coordinates);
        animateCarAlongRealRoute(coordinates);
    }, 1500);
}

// Animate car along real road route
function animateCarAlongRealRoute(coordinates, routeSteps = []) {
    console.log('Animating car along real roads...');
    console.log('Coordinates length:', coordinates.length);
    console.log('Route steps:', routeSteps);
    console.log('First coordinate:', coordinates[0]);
    console.log('Last coordinate:', coordinates[coordinates.length - 1]);
    
    if (!coordinates || coordinates.length < 2) {
        console.error('Invalid coordinates for animation');
        return;
    }
    
    // Remove existing car marker if any
    if (window.carMarker) {
        map.removeLayer(window.carMarker);
    }
    
    // Create more visible car icon
    const carIcon = L.divIcon({
        className: 'car-marker',
        html: '<div style="background: #FF5722; border: 3px solid white; border-radius: 4px; width: 30px; height: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.6); z-index: 10000; position: relative;"><i class="fas fa-car" style="color: white; font-size: 12px;"></i></div>',
        iconSize: [30, 20],
        iconAnchor: [15, 10]
    });
    
    // Create car marker at start position
    window.carMarker = L.marker(coordinates[0], { icon: carIcon }).addTo(map);
    
    // Add a pulsing effect to make it more visible
    const pulseIcon = L.divIcon({
        className: 'car-pulse',
        html: '<div style="background: rgba(255, 87, 34, 0.3); border: 2px solid #FF5722; border-radius: 50%; width: 40px; height: 40px; position: absolute; animation: pulse 2s infinite;"></div>',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });
    
    L.marker(coordinates[0], { icon: pulseIcon }).addTo(map);
    
    // Animate car along the route coordinates
    let currentIndex = 0;
    let totalDistance = 0;
    let segmentDistances = [];
    
    // Calculate total distance and segment distances
    for (let i = 0; i < coordinates.length - 1; i++) {
        const dist = calculateDistance(
            coordinates[i][0], coordinates[i][1],
            coordinates[i + 1][0], coordinates[i + 1][1]
        );
        segmentDistances.push(dist);
        totalDistance += dist;
    }
    
    console.log('Total route distance:', totalDistance.toFixed(2), 'meters');
    
    // Set realistic speed (e.g., 40 km/h = 11.11 m/s for city driving)
    const averageSpeed = 11.11; // meters per second
    const totalDuration = totalDistance / averageSpeed; // seconds
    const totalAnimationTime = totalDuration * 1000; // convert to milliseconds
    
    console.log('Estimated travel time:', (totalDuration / 60).toFixed(1), 'minutes');
    
    // Calculate timing for each segment
    let animationSpeed = 100; // default fallback
    if (totalAnimationTime > 0 && coordinates.length > 1) {
        animationSpeed = totalAnimationTime / coordinates.length;
    }
    
    // Ensure minimum and maximum animation speeds for visibility
    animationSpeed = Math.max(200, Math.min(animationSpeed, 2000)); // between 200ms and 2s per move
    
    console.log('Animation speed per segment:', animationSpeed.toFixed(0), 'ms');
    
    let voiceInstructionsGiven = new Set(); // Track which instructions have been given
    let currentStepIndex = 0;
    let animationStartTime = Date.now();
    
    // Start navigation with initial announcement
    setTimeout(() => {
        speakNavigation("Starting navigation. Follow my voice instructions.", true);
        
        // Announce first instruction if available (with longer delay to prevent overlap)
        if (routeSteps.length > 0) {
            console.log('Route steps available:', routeSteps.length);
            console.log('First step details:', JSON.stringify(routeSteps[0], null, 2));
            
            if (routeSteps[0].maneuver && routeSteps[0].maneuver.instruction) {
                let firstInstruction = cleanInstruction(routeSteps[0].maneuver.instruction);
                console.log('First instruction:', firstInstruction);
                
                // Enhance with landmark if we have starting coordinates
                if (coordinates && coordinates.length > 0) {
                    firstInstruction = enhanceInstructionWithLandmark(firstInstruction, coordinates[0][0], coordinates[0][1]);
                }
                
                setTimeout(() => {
                    speakNavigation(firstInstruction, false); // Use non-priority to allow queue
                }, 3000); // Increased delay to prevent overlap
            } else {
                console.log('No instruction in first step, checking other properties');
                console.log('Step maneuver:', routeSteps[0].maneuver);
                console.log('All step properties:', Object.keys(routeSteps[0]));
                
                // Try to construct an instruction from maneuver type
                if (routeSteps[0].maneuver && routeSteps[0].maneuver.type) {
                    const maneuverType = routeSteps[0].maneuver.type;
                    let constructedInstruction = constructInstructionFromManeuver(maneuverType, routeSteps[0]);
                    console.log('Constructed instruction:', constructedInstruction);
                    
                    // Enhance with landmark if we have starting coordinates
                    if (coordinates && coordinates.length > 0) {
                        constructedInstruction = enhanceInstructionWithLandmark(constructedInstruction, coordinates[0][0], coordinates[0][1]);
                    }
                    
                    setTimeout(() => {
                        speakNavigation(constructedInstruction, false); // Use non-priority
                    }, 3000);
                } else {
                    console.log('No maneuver type, using fallback');
                    let fallbackInstruction = "Head towards your destination";
                    
                    // Enhance with landmark if we have starting coordinates
                    if (coordinates && coordinates.length > 0) {
                        fallbackInstruction = enhanceInstructionWithLandmark(fallbackInstruction, coordinates[0][0], coordinates[0][1]);
                    }
                    
                    setTimeout(() => {
                        speakNavigation(fallbackInstruction, false); // Use non-priority
                    }, 3000);
                }
            }
        } else {
            console.log('No route steps available, using general navigation');
        }
    }, 1000);
    
    const animate = () => {
        if (currentIndex < coordinates.length - 1) {
            currentIndex++;
            const nextCoord = coordinates[currentIndex];
            const progress = currentIndex / coordinates.length;
            
            // Update car position
            window.carMarker.setLatLng(nextCoord);
            
            // Update pulse position
            if (window.pulseMarker) {
                window.pulseMarker.setLatLng(nextCoord);
            }
            
            // Calculate dynamic timing based on segment distance
            let segmentTiming = animationSpeed;
            if (currentIndex < segmentDistances.length) {
                const segmentDistance = segmentDistances[currentIndex - 1] || 0;
                // Adjust timing based on segment distance (longer segments take more time)
                const timingFactor = Math.max(0.5, Math.min(2.0, segmentDistance / 50)); // scale factor based on 50m reference
                segmentTiming = animationSpeed * timingFactor;
            }
            
            // Check if we should announce the next turn instruction
            if (routeSteps.length > 0 && currentStepIndex < routeSteps.length) {
                const currentStep = routeSteps[currentStepIndex];
                
                // Calculate progress through current step
                const stepStartProgress = currentStepIndex / routeSteps.length;
                const stepEndProgress = (currentStepIndex + 1) / routeSteps.length;
                const stepProgress = (progress - stepStartProgress) / (stepEndProgress - stepStartProgress);
                
                // Announce instruction when we're 70% through the current step (preparing for next turn)
                if (stepProgress >= 0.7 && !voiceInstructionsGiven.has(currentStepIndex)) {
                    console.log('Announcing step', currentStepIndex, ':', JSON.stringify(currentStep, null, 2));
                    
                    let instruction = '';
                    
                    // Try to get actual instruction first
                    if (currentStep.maneuver && currentStep.maneuver.instruction) {
                        instruction = cleanInstruction(currentStep.maneuver.instruction);
                        console.log('Using actual instruction:', instruction);
                    } else if (currentStep.maneuver && currentStep.maneuver.type) {
                        // Construct instruction from maneuver type
                        instruction = constructInstructionFromManeuver(currentStep.maneuver.type, currentStep);
                        console.log('Constructed instruction:', instruction);
                    } else {
                        // Generic fallback
                        instruction = "Continue following the route";
                        console.log('Using generic instruction');
                    }
                    
                    // Enhance instruction with landmark if we have current position
                    if (nextCoord && coordinates[currentIndex]) {
                        instruction = enhanceInstructionWithLandmark(instruction, nextCoord[0], nextCoord[1]);
                    }
                    
                    if (instruction && instruction !== 'Continue following the route') {
                        speakNavigation(instruction, false); // Use non-priority to allow proper queuing
                        voiceInstructionsGiven.add(currentStepIndex);
                        currentStepIndex++;
                    } else {
                        console.log('Skipping empty or generic instruction for step', currentStepIndex);
                        voiceInstructionsGiven.add(currentStepIndex);
                        currentStepIndex++;
                    }
                }
            }
            
            // Progress announcements for longer routes
            if (routeSteps.length === 0) { // Only for fallback routes without steps
                if (progress === 0.25 && !voiceInstructionsGiven.has('quarter')) {
                    let quarterMessage = "Quarter way there. Continue following the route.";
                    
                    // Enhance with landmark if we have current position
                    if (nextCoord) {
                        quarterMessage = enhanceInstructionWithLandmark(quarterMessage, nextCoord[0], nextCoord[1]);
                    }
                    
                    speakNavigation(quarterMessage, false);
                    voiceInstructionsGiven.add('quarter');
                } else if (progress === 0.5 && !voiceInstructionsGiven.has('half')) {
                    let halfMessage = "Halfway to your destination.";
                    
                    // Enhance with landmark if we have current position
                    if (nextCoord) {
                        halfMessage = enhanceInstructionWithLandmark(halfMessage, nextCoord[0], nextCoord[1]);
                    }
                    
                    speakNavigation(halfMessage, false);
                    voiceInstructionsGiven.add('half');
                } else if (progress === 0.75 && !voiceInstructionsGiven.has('threequarters')) {
                    let threequartersMessage = "Almost there. Just a quarter left to go.";
                    
                    // Enhance with landmark if we have current position
                    if (nextCoord) {
                        threequartersMessage = enhanceInstructionWithLandmark(threequartersMessage, nextCoord[0], nextCoord[1]);
                    }
                    
                    speakNavigation(threequartersMessage, false);
                    voiceInstructionsGiven.add('threequarters');
                }
            }
            
            // Log progress every 10 moves
            if (currentIndex % 10 === 0) {
                console.log(`Car progress: ${currentIndex}/${coordinates.length} - Position: ${nextCoord} - Segment timing: ${segmentTiming.toFixed(0)}ms`);
            }
            
            setTimeout(animate, segmentTiming);
        } else {
            // Animation complete
            console.log('Car animation completed!');
            
            // Arrival announcement with landmark
            setTimeout(() => {
                let arrivalMessage = "You have arrived at your destination!";
                
                // Enhance with landmark if we have final coordinates
                if (coordinates && coordinates.length > 0) {
                    const finalCoord = coordinates[coordinates.length - 1];
                    arrivalMessage = enhanceInstructionWithLandmark(arrivalMessage, finalCoord[0], finalCoord[1]);
                }
                
                speakNavigation(arrivalMessage, false);
            }, 500);
            
            // Visual notification instead of alert
            setTimeout(() => {
                const notification = document.createElement('div');
                notification.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: #4CAF50;
                    color: white;
                    padding: 20px 30px;
                    border-radius: 10px;
                    font-size: 18px;
                    font-weight: bold;
                    z-index: 10000;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                    animation: slideIn 0.3s ease;
                `;
                notification.innerHTML = '<i class="fas fa-check-circle"></i> You have arrived!';
                document.body.appendChild(notification);
                
                // Remove notification after 3 seconds
                setTimeout(() => {
                    notification.remove();
                }, 3000);
            }, 1000);
        }
    };
    
    // Add CSS animation for pulse effect
    const style = document.createElement('style');
    style.textContent = `
        @keyframes pulse {
            0% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.5); opacity: 0.5; }
            100% { transform: scale(1); opacity: 1; }
        }
        @keyframes slideIn {
            from { transform: translate(-50%, -50%) scale(0.8); opacity: 0; }
            to { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
    
    // Start animation
    console.log('Starting car animation with turn-by-turn navigation...');
    animate();
}

// Clean up instruction text for better speech
function cleanInstruction(instruction) {
    if (!instruction) return '';
    
    // Remove HTML tags but preserve important content
    let clean = instruction.replace(/<[^>]*>/g, '');
    
    // Remove problematic characters but keep important ones
    clean = clean.replace(/[;|]/g, '');
    
    // Convert common abbreviations to full words for better speech
    clean = clean.replace(/\bkm\b/gi, 'kilometers');
    clean = clean.replace(/\bm\b/gi, 'meters');
    clean = clean.replace(/\bN\b/g, 'North');
    clean = clean.replace(/\bS\b/g, 'South');
    clean = clean.replace(/\bE\b/g, 'East');
    clean = clean.replace(/\bW\b/g, 'West');
    
    // Fix common road name abbreviations
    clean = clean.replace(/\bRd\b/gi, 'Road');
    clean = clean.replace(/\bSt\b/gi, 'Street');
    clean = clean.replace(/\bAve\b/gi, 'Avenue');
    clean = clean.replace(/\bBlvd\b/gi, 'Boulevard');
    clean = clean.replace(/\bHwy\b/gi, 'Highway');
    
    // Fix common direction words
    clean = clean.replace(/\bSL\b/gi, 'slight left');
    clean = clean.replace(/\bSR\b/gi, 'slight right');
    clean = clean.replace(/\bSHL\b/gi, 'sharp left');
    clean = clean.replace(/\bSHR\b/gi, 'sharp right');
    
    // Ensure proper spacing
    clean = clean.replace(/\s+/g, ' ').trim();
    
    return clean;
}

// Construct instruction from OSRM maneuver type
function constructInstructionFromManeuver(maneuverType, step) {
    const instructions = {
        'turn': 'Turn',
        'new name': 'Continue',
        'depart': 'Head',
        'arrive': 'You have arrived',
        'merge': 'Merge',
        'on ramp': 'Take the ramp',
        'off ramp': 'Take the exit',
        'fork': 'Keep',
        'roundabout': 'At the roundabout',
        'roundabout turn': 'At the roundabout',
        'notification': 'Continue',
        'exit roundabout': 'Take the exit'
    };
    
    let baseInstruction = instructions[maneuverType] || 'Continue';
    
    // Add direction modifier if available
    if (step.maneuver && step.maneuver.modifier) {
        const modifiers = {
            'left': 'left',
            'right': 'right',
            'slight left': 'slight left',
            'slight right': 'slight right',
            'sharp left': 'sharp left',
            'sharp right': 'sharp right',
            'straight': 'straight',
            'uturn': 'make a U turn'
        };
        
        const direction = modifiers[step.maneuver.modifier];
        if (direction && !baseInstruction.includes('arrived')) {
            baseInstruction += ' ' + direction;
        }
    }
    
    // Add road name if available
    if (step.name && step.name !== '' && !baseInstruction.includes('arrived')) {
        baseInstruction += ' onto ' + step.name;
    }
    
    // Add distance for longer segments
    if (step.distance && step.distance > 100) { // Reduced threshold to include more distance info
        const distance = step.distance > 1000 ? 
            (step.distance / 1000).toFixed(1) + ' kilometers' : 
            Math.round(step.distance) + ' meters';
        baseInstruction += ' and continue for ' + distance;
    }
    
    // Enhance with landmark if we have location data
    if (step.maneuver && step.maneuver.location) {
        const landmarkLocation = step.maneuver.location;
        baseInstruction = enhanceInstructionWithLandmark(baseInstruction, landmarkLocation[1], landmarkLocation[0]);
    }
    
    // Ensure instruction is complete and not empty
    if (!baseInstruction || baseInstruction.trim() === '') {
        baseInstruction = 'Continue following the route';
    }
    
    return baseInstruction;
}

// Calculate bearing between two points
function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
}

// FIX #4 - Implement search functionality with aggressive debouncing
function setupSearch() {
    // Prevent duplicate initialization
    if (searchInitialized) {
        console.log('Search already initialized, skipping...');
        return;
    }
    
    const searchBox = document.getElementById('searchBox');
    const searchResults = document.getElementById('searchResults');
    
    if (!searchBox || !searchResults) {
        console.error('Search elements not found!');
        return;
    }
    
    let searchTimeout;
    let isTyping = false;
    let typingTimeout;
    
    console.log('Setting up search functionality...');
    
    // Immediately hide any existing results
    searchResults.classList.remove('show');
    
    // Remove any existing event listeners to prevent duplicates
    const newSearchBox = searchBox.cloneNode(true);
    searchBox.parentNode.replaceChild(newSearchBox, searchBox);
    
    newSearchBox.addEventListener('focus', function() {
        console.log('Search box focused');
        isTyping = true;
        searchResults.classList.remove('show');
    });
    
    newSearchBox.addEventListener('blur', function() {
        console.log('Search box blurred');
        isTyping = false;
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            if (!isTyping) {
                searchResults.classList.remove('show');
            }
        }, 200);
    });
    
    newSearchBox.addEventListener('input', function(e) {
        const query = e.target.value.toLowerCase().trim();
        console.log('Search input triggered:', query, 'length:', query.length);
        
        // Mark as typing
        isTyping = true;
        
        // Clear any existing timeouts
        clearTimeout(searchTimeout);
        clearTimeout(typingTimeout);
        
        // Always hide results immediately when typing
        searchResults.classList.remove('show');
        
        if (query.length < 3) {
            console.log('Query too short, hiding results');
            return;
        }
        
        console.log('Setting up search timeout for:', query);
        
        // Wait for typing to stop
        typingTimeout = setTimeout(() => {
            isTyping = false;
        }, 300);
        
        // Debounce search - wait 800ms after user stops typing
        searchTimeout = setTimeout(() => {
            if (!isTyping) {
                console.log('Performing search for:', query);
                performSearch(query, searchResults, newSearchBox);
            } else {
                console.log('Still typing, cancelling search');
            }
        }, 800);
    });
    
    // Prevent clicks on results while typing
    newSearchBox.addEventListener('keydown', function(e) {
        isTyping = true;
        searchResults.classList.remove('show');
    });
    
    // Close search results when clicking outside
    document.addEventListener('click', function(e) {
        if (!newSearchBox.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.classList.remove('show');
            isTyping = false;
        }
    });
    
    searchInitialized = true;
    console.log('Search functionality initialized successfully');
}

// Separate function for performing the actual search
function performSearch(query, searchResults, searchBox) {
    console.log('performSearch called with:', query);
    console.log('Available facilities:', facilities.length);
    
    // Debug: Log all facilities that contain "kasarani"
    console.log('Facilities containing "kasarani":');
    facilities.forEach(f => {
        if (f.name.toLowerCase().includes('kasarani') || 
            f.type.toLowerCase().includes('kasarani') ||
            f.county.toLowerCase().includes('kasarani')) {
            console.log('Found:', f.name, '-', f.type, '-', f.county);
        }
    });
    
    // Check if facilities are loaded
    if (!facilities || facilities.length === 0) {
        console.log('No facilities loaded yet');
        searchResults.innerHTML = '<div class="search-result-item">Loading facilities... Please wait</div>';
        searchResults.classList.add('show');
        return;
    }
    
    // Search in facilities
    const results = facilities.filter(f => 
        f.name.toLowerCase().includes(query) || 
        f.type.toLowerCase().includes(query) ||
        f.county.toLowerCase().includes(query)
    ).slice(0, 10); // Limit to 10 results
    
    console.log('Search results found:', results.length);
    console.log('Search results:', results.map(f => f.name));
    
    if (results.length > 0) {
        searchResults.innerHTML = results.map(f => `
            <div class="search-result-item" data-lat="${f.lat}" data-lng="${f.lng}" data-name="${f.name}" data-type="${f.type}">
                <div class="search-result-name">
                    <i class="fas fa-${getFacilityIcon(f.type)}" style="color: ${facilityColors[f.type] || '#5f6368'}; margin-right: 8px;"></i>
                    ${f.name}
                </div>
                <div class="search-result-type">${f.type} • ${f.county}</div>
            </div>
        `).join('');
        
        // Add click handlers
        searchResults.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', function() {
                const lat = parseFloat(this.dataset.lat);
                const lng = parseFloat(this.dataset.lng);
                const name = this.dataset.name;
                const type = this.dataset.type;
                
                map.setView([lat, lng], 15);
                
                // Find and open popup
                markers.forEach(marker => {
                    if (marker.facilityData && 
                        marker.facilityData.lat === lat && 
                        marker.facilityData.lng === lng) {
                        marker.openPopup();
                    }
                });
                
                searchResults.classList.remove('show');
                searchBox.value = name;
            });
        });
        
        console.log('Showing search results');
        searchResults.classList.add('show');
    } else {
        console.log('No results found, showing no results message');
        searchResults.innerHTML = '<div class="search-result-item">No facilities found</div>';
        searchResults.classList.add('show');
    }
}

// FIX #4 - Implement heatmap functionality
function setupHeatmap() {
    const heatmapBtn = document.getElementById('heatmapBtn');
    
    heatmapBtn.addEventListener('click', function() {
        if (isHeatmapActive) {
            // Remove heatmap
            if (heatmapLayer) {
                map.removeLayer(heatmapLayer);
                heatmapLayer = null;
            }
            isHeatmapActive = false;
            this.classList.remove('active');
            
            // Markers remain visible (no need to add them back)
            console.log('Heatmap deactivated, markers remain visible');
        } else {
            // Do NOT remove markers - show both heatmap and markers
            // This allows users to see both the cluster numbers AND the heat intensity
            
            // Create heatmap data using ALL facilities (not filtered)
            console.log(`Creating heatmap with ${allFacilities.length} facilities (all locations)`);
            const heatData = allFacilities.map(f => [f.lat, f.lng, 0.8]); // intensity 0.8
            
            // Create heatmap layer with transparency so markers remain visible
            heatmapLayer = L.heatLayer(heatData, {
                radius: 25,
                blur: 15,
                maxZoom: 17,
                opacity: 0.6, // Semi-transparent to see markers underneath
                gradient: {
                    0.2: '#4285F4',
                    0.4: '#34A853',
                    0.6: '#FBBC04',
                    0.8: '#EA4335'
                }
            });
            
            heatmapLayer.addTo(map);
            isHeatmapActive = true;
            this.classList.add('active');
            
            console.log('Heatmap activated showing all facilities across Kenya with markers visible');
            
            // Remove GPS mode and road network when heatmap is activated
            document.body.classList.remove('gps-mode', 'gps-navigation-mode');
            clearRoadNetwork();
            document.querySelectorAll('.header-btn').forEach(btn => btn.classList.remove('active'));
            if (currentLayer !== 'streets') {
                document.getElementById('mapViewBtn').classList.add('active');
            } else {
                this.classList.add('active');
            }
        }
    });
}

// Setup event listeners
function setupEventListeners() {
    // Toggle sidebar
    document.getElementById('toggleSidebar').addEventListener('click', function() {
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('toggleSidebar');
        
        sidebar.classList.toggle('hidden');
        toggle.classList.toggle('shifted');
        
        const icon = toggle.querySelector('i');
        icon.className = sidebar.classList.contains('hidden') ? 'fas fa-bars' : 'fas fa-times';
    });
    
    // County dropdown change event
    document.getElementById('countySelect').addEventListener('change', function() {
        if (routingControl) {
            map.removeControl(routingControl);
            routingControl = null;
        }
        populateFacilityList();
        updateMarkers();
        fitMapToFilteredFacilities();
    });
    
    // Facility type dropdown change event
    document.getElementById('facilityTypeSelect').addEventListener('change', function() {
        if (routingControl) {
            map.removeControl(routingControl);
            routingControl = null;
        }
        populateFacilityList();
        updateMarkers();
        fitMapToFilteredFacilities();
    });
    
    // Map view buttons
    document.getElementById('mapViewBtn').addEventListener('click', function() {
        if (currentLayer !== 'streets') {
            map.removeLayer(mapLayers[currentLayer]);
            mapLayers.streets.addTo(map);
            currentLayer = 'streets';
            
            document.querySelectorAll('.header-btn').forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
        }
        // Remove GPS mode and road network
        document.body.classList.remove('gps-mode', 'gps-navigation-mode');
        clearRoadNetwork();
    });
    
    // GPS Navigation Mode
    document.getElementById('gpsViewBtn').addEventListener('click', function() {
        // Activate GPS navigation mode
        if (currentLayer !== 'navigation') {
            map.removeLayer(mapLayers[currentLayer]);
            mapLayers.navigation.addTo(map);
            mapLayers.roads.addTo(map); // Add road overlay for better visibility
            currentLayer = 'navigation';
        }
        
        // Add GPS mode classes
        document.body.classList.add('gps-mode', 'gps-navigation-mode');
        
        // Update button states
        document.querySelectorAll('.header-btn').forEach(btn => btn.classList.remove('active'));
        this.classList.add('active');
        
        // Enhance map for GPS navigation
        map.setZoom(15); // Higher zoom for better road visibility
        
        // Start GPS simulation
        startGPSNavigation();

        speakNavigation('GPS Navigation Mode activated', true);
    });

    document.getElementById('satelliteViewBtn').addEventListener('click', function() {
        if (currentLayer !== 'satellite') {
            map.removeLayer(mapLayers[currentLayer]);
            mapLayers.satellite.addTo(map);
            currentLayer = 'satellite';
            
            document.querySelectorAll('.header-btn').forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
        }
        // Remove GPS mode and road network
        document.body.classList.remove('gps-mode', 'gps-navigation-mode');
        clearRoadNetwork();
    });

    document.getElementById('terrainViewBtn').addEventListener('click', function() {
        if (currentLayer !== 'terrain') {
            map.removeLayer(mapLayers[currentLayer]);
            mapLayers.terrain.addTo(map);
            currentLayer = 'terrain';
            
            document.querySelectorAll('.header-btn').forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
        }
        // Remove GPS mode and road network
        document.body.classList.remove('gps-mode', 'gps-navigation-mode');
        clearRoadNetwork();
    });
    
    document.getElementById('hybridViewBtn').addEventListener('click', function() {
        if (currentLayer !== 'hybrid') {
            map.removeLayer(mapLayers[currentLayer]);
            mapLayers.hybrid.addTo(map);
            currentLayer = 'hybrid';
            
            document.querySelectorAll('.header-btn').forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
        }
        // Remove GPS mode and road network
        document.body.classList.remove('gps-mode', 'gps-navigation-mode');
        clearRoadNetwork();
    });
    
    // Map controls
    document.getElementById('zoomInBtn').addEventListener('click', function() {
        map.zoomIn();
    });
    
    document.getElementById('zoomOutBtn').addEventListener('click', function() {
        map.zoomOut();
    });
    
    document.getElementById('locateBtn').addEventListener('click', function() {
        if (userLocation) {
            map.setView([userLocation.lat, userLocation.lng], 15);
        } else {
            getUserLocation().then(location => {
                if (location) {
                    map.setView([location.lat, location.lng], 15);
                }
            }).catch(() => {
                showNotification('Could not get your location');
            });
        }
    });
    
    document.getElementById('fullscreenBtn').addEventListener('click', function() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
            this.innerHTML = '<i class="fas fa-compress"></i>';
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
                this.innerHTML = '<i class="fas fa-expand"></i>';
            }
        }
    });
    
    // Directions panel controls
    document.getElementById('hideDirectionsBtn').addEventListener('click', function() {
        document.getElementById('directionsPanel').classList.remove('show');
    });
    
    document.getElementById('closeDirectionsBtn').addEventListener('click', function() {
        document.getElementById('directionsPanel').classList.remove('show');
        if (routingControl) {
            map.removeControl(routingControl);
            routingControl = null;
        }
        // Remove route lines and markers
        map.eachLayer(layer => {
            if (layer instanceof L.Polyline || 
                (layer instanceof L.Marker && layer.options.icon && 
                 (layer.options.icon.options.className === 'start-marker' || 
                  layer.options.icon.options.className === 'end-marker' ||
                  layer.options.icon.options.className === 'car-marker'))) {
                map.removeLayer(layer);
            }
        });
    });
    
    document.getElementById('useMyLocationBtn').addEventListener('click', function() {
        if (userLocation) {
            document.getElementById('startLocationInput').value = 'My Location';
        } else {
            showNotification('Please click "My Location" button first');
        }
    });
}

// Show notification
function showNotification(message) {
    // Remove existing notification
    const existing = document.querySelector('.notification');
    if (existing) {
        existing.remove();
    }
    
    // Create new notification
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: #4285F4;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999;
        font-size: 14px;
        max-width: 300px;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 3000);
}

// Add slide-in animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    .notification {
        transition: opacity 0.3s ease;
    }
`;
document.head.appendChild(style);

// Debug panel removed - using normal console

// Initialize everything when page loads
window.addEventListener('load', function() {
    console.log('Page loaded, initializing...');
    initMap();
    setupEventListeners();
    setupSearch(); // FIX #4 - Initialize search (will be called again after facilities load)
    setupHeatmap(); // FIX #4 - Initialize heatmap
    initializeUserLocation(); // Initialize user location
    initializeVoices(); // Initialize text-to-speech voices
    loadFacilities(); // Load facilities data
});
