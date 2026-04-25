// Global variables
let map = null;
let facilities = [];
let markers = [];
let markerCluster = null;
let userLocation = null;
let selectedFacility = null;
let routingControl = null;
let apiCache = new Map(); // Cache API responses
let iconCache = new Map(); // Cache map icons
let speechEngine = window.speechSynthesis;
let currentSpeech = null;
let navigationEnabled = true;
let currentLayer = 'streets'; // Track current map layer


// Map layers
let currentBaseLayer = null;
let streetLayer = null;
let satelliteLayer = null;
let terrainLayer = null;


// Nearest road calculation - finds road with shortest driving path
function findNearestRoad(lat, lng, callback) {
    // Check cache first
    const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (apiCache.has(cacheKey)) {
        callback(null, apiCache.get(cacheKey));
        return;
    }
    
    // Use Overpass API to query nearby roads
    const overpassQuery = `
        [out:json][timeout:10];
        (
            way["highway"](around:200,${lat},${lng});
        );
        out geom;
    `;
    
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
    
    fetch(overpassUrl)
        .then(response => response.json())
        .then(data => {
            if (data.elements && data.elements.length > 0) {
                findRoadWithShortestPath(data.elements, lat, lng, callback);
            } else {
                callback('No roads found nearby', null);
            }
        })
        .catch(error => {
            callback(error, null);
        });
}

// Find road with shortest driving path using OSRM routing
function findRoadWithShortestPath(roads, facilityLat, facilityLng, callback) {
    // Limit to first 5 roads for performance
    const limitedRoads = roads.slice(0, 5);
    
    let roadResults = [];
    let processedCount = 0;
    
    limitedRoads.forEach((road, index) => {
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
                    if (processedCount === limitedRoads.length) {
                        // All roads processed, find the one with shortest path
                        const shortestRoad = findShortestDrivingRoad(roadResults);
                        callback(null, shortestRoad);
                    }
                })
                .catch(error => {
                    processedCount++;
                    if (processedCount === limitedRoads.length) {
                        const shortestRoad = findShortestDrivingRoad(roadResults);
                        callback(null, shortestRoad);
                    }
                });
        } else {
            processedCount++;
            if (processedCount === limitedRoads.length) {
                const shortestRoad = findShortestDrivingRoad(roadResults);
                callback(null, shortestRoad);
            }
        }
    });
    
    // Handle case where no roads have valid geometry
    if (limitedRoads.length === 0) {
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

// Optimized point-in-polygon algorithm for precise county detection
function isPointInPolygon(lat, lng, polyCoords) {
    let x = lng, y = lat;
    let inside = false;
    for (let i = 0, j = polyCoords.length - 1; i < polyCoords.length; j = i++) {
        let xi = polyCoords[i][0], yi = polyCoords[i][1];
        let xj = polyCoords[j][0], yj = polyCoords[j][1];
        let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
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
    } else {
        speechSynthesis.addEventListener('voiceschanged', () => {
            voicesLoaded = true;
        }, { once: true });
    }
}

// Initialize voices on load
initializeVoices();

// Unlock speech synthesis on first user interaction (required by browsers)
let speechUnlocked = false;
function unlockSpeech() {
    if (!speechUnlocked && window.speechSynthesis) {
        const silent = new SpeechSynthesisUtterance('');
        silent.volume = 0;
        window.speechSynthesis.speak(silent);
        speechUnlocked = true;
    }
}

// Add unlock listeners
['click', 'touchstart', 'keydown'].forEach(event => {
    document.addEventListener(event, unlockSpeech, { once: true });
});

// Speak navigation instructions with proper queue management
function speakNavigation(text, priority = false) {
    // Check if voice navigation is enabled
    if (!navigationEnabled) {
        console.log('Voice navigation disabled, skipping:', text);
        return;
    }
    
    // Check if speech synthesis is available
    if (!window.speechSynthesis) {
        console.log('Speech synthesis not available');
        return;
    }
    
    // Ensure voices are loaded
    if (!voicesLoaded) {
        // Try again after voices load
        setTimeout(() => speakNavigation(text, priority), 100);
        return;
    }
    
    // Handle priority speech (cancel current and clear queue for important announcements)
    if (priority) {
        // Cancel current speech
        if (speechSynthesis.speaking) {
            speechSynthesis.cancel();
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
        setTimeout(() => processSpeechQueue(), 100);
        return;
    }
    
    isProcessingQueue = true;
    const speechItem = speechQueue.shift();
    
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
    }
    
    // Add event listeners for better debugging and queue management
    utterance.onstart = () => {
        // Speech started
    };
    
    utterance.onend = () => {
        currentUtterance = null;
        isProcessingQueue = false;
        
        // Process next item in queue
        setTimeout(() => processSpeechQueue(), 50);
    };
    
    utterance.onerror = (event) => {
        currentUtterance = null;
        isProcessingQueue = false;
        
        // Continue processing queue even on error
        setTimeout(() => processSpeechQueue(), 100);
    };
    
    utterance.onpause = () => {
        // Speech paused
    };
    
    utterance.onresume = () => {
        // Speech resumed
    };
    
    currentUtterance = utterance;
    
    try {
        speechSynthesis.speak(utterance);
    } catch (error) {
        currentUtterance = null;
        isProcessingQueue = false;
        
        // Continue processing queue
        setTimeout(() => processSpeechQueue(), 100);
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
                resolve(location);
            },
            (error) => {
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
        // Location not available
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

// Facility type colors by category
const facilityColors = {
    // Health
    'Hospital': '#ea4335',
    'Clinic': '#f39c12',
    'Medical': '#ff5722',
    'Health Facility': '#ff5722',
    
    // Education
    'School': '#4285F4',
    'University': '#1565c0',
    'College': '#1976d2',
    'Education': '#3f51b5',
    
    // Religious
    'Church': '#8e24aa',
    'Cathedral': '#8e24aa',
    'Mosque': '#8e24aa',
    'Temple': '#8e24aa',
    
    // Financial
    'Bank': '#2e7d32',
    'ATM': '#0288d1',
    'Financial': '#607d8b',
    
    // Hotels
    'Hotel': '#ff6d00',
    'Lodge': '#ff6d00',
    
    // Food
    'Restaurant': '#f44336',
    'Cafe': '#f44336',
    'Bar': '#f44336',
    
    // Services
    'Police Station': '#424242',
    'Fire Station': '#ff5722',
    'Library': '#7b1fa2',
    
    // Recreation
    'Park': '#4caf50',
    'Garden': '#4caf50',
    
    // Shopping
    'Market': '#ff9800',
    'Mall': '#ff9800',
    
    // Transport
    'Airport': '#ff6d00',
    'Transport': '#ff6d00',
    
    // Default
    'Facility': '#5f6368',
    'POI': '#9e9e9e'
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

function initMap() {
    map = L.map('map').setView([-1.2921, 36.8219], 6);
    
    // Add base layers
    mapLayers.streets.addTo(map);
    currentLayer = 'streets';
    
    // Set bounds to Kenya
    const kenyaBounds = [[-4.9, 33.7], [5.0, 42.0]];
    map.setMaxBounds(kenyaBounds);
    
    // Add road overlay for enhanced road visibility
    mapLayers.roads.addTo(map);
    
    // Set active button
    document.getElementById('mapViewBtn').classList.add('active');
    // map.on('zoomend', handleMapMove);
    
    // Virtual rendering disabled for performance
}

// GPS-style map enhancements - DISABLED for performance
function addGPSStyleEnhancements() {
    // DISABLED: Resource-intensive GPS features
    
    // Only add minimal styling
    const gpsStyles = document.createElement('style');
    gpsStyles.textContent = `
        .leaflet-container {
            background: #f8f9fa;
        }
    `;
    document.head.appendChild(gpsStyles);
    
    // DISABLED: GPS compass, speed indicator, and road display for performance
    // addGPSCompass();
    // addSpeedIndicator();
    // addCurrentRoadDisplay();
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

// Voice Navigation Functions - simplified working version
function speakDirection(text, priority = false) {
    // Use the main speech system
    speakNavigation(text, priority);
}

function findNearbyLandmarks(lat, lng, radius = 0.5) {
    // Find facilities near the current position for landmark references
    return facilities.filter(facility => {
        if (!facility.lat || !facility.lng) return false;
        
        const distance = calculateDistance(lat, lng, facility.lat, facility.lng);
        return distance <= radius; // Within 500 meters
    }).sort((a, b) => {
        const distA = calculateDistance(lat, lng, a.lat, a.lng);
        const distB = calculateDistance(lat, lng, b.lat, b.lng);
        return distA - distB;
    });
}

function createLandmarkBasedInstruction(lat, lng, baseInstruction) {
    const landmarks = findNearbyLandmarks(lat, lng, 0.3); // 300m radius
    
    if (landmarks.length === 0) return baseInstruction;
    
    const mainLandmark = landmarks[0];
    const distance = calculateDistance(lat, lng, mainLandmark.lat, mainLandmark.lng);
    const distanceText = distance < 100 ? 'about 50 meters' : 
                        distance < 200 ? 'about 100 meters' : 
                        distance < 300 ? 'about 200 meters' : 'about 300 meters';
    
    // Create landmark-enhanced instruction
    let landmarkInstruction = baseInstruction;
    
    if (mainLandmark.type === 'hospital') {
        landmarkInstruction += ` near ${mainLandmark.name}`;
    } else if (mainLandmark.type === 'school') {
        landmarkInstruction += ` by ${mainLandmark.name}`;
    } else if (mainLandmark.type === 'church') {
        landmarkInstruction += ` past ${mainLandmark.name}`;
    } else if (mainLandmark.type === 'bank') {
        landmarkInstruction += ` close to ${mainLandmark.name}`;
    } else {
        landmarkInstruction += ` near ${mainLandmark.name}`;
    }
    
    return landmarkInstruction;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c * 1000; // Distance in meters
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

// GPS Navigation - Car follows actual roads with REAL turn-by-turn directions
function animateGPSRoute(routeCoordinates, routeSteps) {
    if (!routeCoordinates || routeCoordinates.length < 2) {
        console.log('No route coordinates for GPS navigation');
        return;
    }
    
    console.log('Starting GPS navigation along', routeCoordinates.length, 'road points');
    console.log('Route steps:', routeSteps ? routeSteps.length : 0);
    
    // Clear ALL existing car markers and related elements
    if (window.carMarker) {
        map.removeLayer(window.carMarker);
        window.carMarker = null;
    }
    if (window.pulseMarker) {
        map.removeLayer(window.pulseMarker);
        window.pulseMarker = null;
    }
    
    // Remove any existing car-pulse elements from DOM
    document.querySelectorAll('.car-pulse, .car-marker').forEach(el => {
        if (el.parentElement) el.parentElement.remove();
    });
    
    // Create realistic GPS car marker - bigger and car-shaped
    const carIcon = L.divIcon({
        html: `
            <div style="
                width: 40px;
                height: 40px;
                position: relative;
                filter: drop-shadow(0 4px 8px rgba(0,0,0,0.4));
            ">
                <!-- Car body -->
                <div style="
                    position: absolute;
                    bottom: 8px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 28px;
                    height: 20px;
                    background: linear-gradient(135deg, #1a73e8 0%, #4285F4 50%, #1a73e8 100%);
                    border-radius: 6px 6px 3px 3px;
                    border: 2px solid white;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                "></div>
                <!-- Car roof/windshield -->
                <div style="
                    position: absolute;
                    bottom: 22px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 18px;
                    height: 10px;
                    background: linear-gradient(135deg, #42a5f5 0%, #90caf9 100%);
                    border-radius: 4px 4px 0 0;
                    border: 2px solid white;
                    border-bottom: none;
                "></div>
                <!-- Front indicator arrow -->
                <div style="
                    position: absolute;
                    top: 0;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 0;
                    height: 0;
                    border-left: 8px solid transparent;
                    border-right: 8px solid transparent;
                    border-bottom: 12px solid #ea4335;
                    filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3));
                "></div>
                <!-- Wheels -->
                <div style="
                    position: absolute;
                    bottom: 4px;
                    left: 6px;
                    width: 6px;
                    height: 6px;
                    background: #333;
                    border-radius: 50%;
                    border: 1px solid white;
                "></div>
                <div style="
                    position: absolute;
                    bottom: 4px;
                    right: 6px;
                    width: 6px;
                    height: 6px;
                    background: #333;
                    border-radius: 50%;
                    border: 1px solid white;
                "></div>
            </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        className: 'gps-car'
    });
    
    window.carMarker = L.marker(routeCoordinates[0], { icon: carIcon }).addTo(map);
    window.carMarker.setZIndexOffset(1000);
    
    let currentIndex = 0;
    const totalPoints = routeCoordinates.length;
    let currentStepIndex = 0;
    
    // Build real turn-by-turn directions from OSRM steps with proper GPS announcements
    let turnByTurnDirections = [];
    if (routeSteps && routeSteps.length > 0) {
        let lastStreet = '';
        let cumulativeDistance = 0;
        
        routeSteps.forEach((step, idx) => {
            // Get maneuver information
            const maneuver = step.maneuver || {};
            const maneuverType = maneuver.type || 'straight';
            const modifier = maneuver.modifier || '';
            let instruction = maneuver.instruction || '';
            const street = step.name || '';
            const stepDistance = step.distance;
            const distanceKm = (stepDistance / 1000).toFixed(1);
            const distanceM = Math.round(stepDistance);
            
            // Build proper GPS-style instruction
            let gpsInstruction = '';
            let announcementType = 'straight';
            
            // Handle different maneuver types
            if (maneuverType === 'roundabout' || instruction.toLowerCase().includes('roundabout')) {
                // Roundabout handling
                const exit = maneuver.exit || 1;
                const exitText = exit === 1 ? 'first' : exit === 2 ? 'second' : exit === 3 ? 'third' : exit + 'th';
                gpsInstruction = `At the roundabout, take the ${exitText} exit`;
                if (street) gpsInstruction += ` onto ${street}`;
                announcementType = 'roundabout';
                
            } else if (maneuverType === 'turn' || maneuverType === 'left' || maneuverType === 'right') {
                // Turn handling
                let turnText = '';
                if (modifier === 'left' || maneuverType === 'left') turnText = 'Turn left';
                else if (modifier === 'right' || maneuverType === 'right') turnText = 'Turn right';
                else if (modifier === 'slight left') turnText = 'Turn slight left';
                else if (modifier === 'slight right') turnText = 'Turn slight right';
                else turnText = 'Turn';
                
                gpsInstruction = turnText;
                if (street && street !== lastStreet && !gpsInstruction.includes(street)) {
                    gpsInstruction += ` onto ${street}`;
                } else if (street && !gpsInstruction.includes(street)) {
                    gpsInstruction += ` on ${street}`;
                }
                announcementType = 'turn';
                
            } else if (maneuverType === 'uturn') {
                gpsInstruction = 'Make a U-turn';
                if (street && !gpsInstruction.includes(street)) gpsInstruction += ` on ${street}`;
                announcementType = 'uturn';
                
            } else if (maneuverType === 'new name' || (street && street !== lastStreet && stepDistance < 100)) {
                // Road name change
                gpsInstruction = `Continue onto ${street}`;
                announcementType = 'road_change';
                
            } else if (maneuverType === 'straight' || stepDistance > 500) {
                // Long straight section
                if (street && street !== lastStreet) {
                    gpsInstruction = `Continue on ${street}`;
                    announcementType = 'straight';
                } else {
                    // Skip short straight segments without road changes
                    return;
                }
                
            } else if (maneuverType === 'arrive' || idx === routeSteps.length - 1) {
                gpsInstruction = 'You have arrived at your destination';
                announcementType = 'arrive';
                
            } else {
                // Skip other minor instructions
                return;
            }
            
            // Remove 'end of road' and clean up duplicates
            gpsInstruction = gpsInstruction.replace(/end of road/gi, '').replace(/\s+/g, ' ').trim();
            
            // Remove duplicate road names (e.g., "on Mombasa Road on Mombasa Road" -> "on Mombasa Road")
            const roadNamePattern = /on\s+([^.\s]+(?:\s+[^.\s]+)*)/;
            const matches = gpsInstruction.match(roadNamePattern);
            if (matches && matches.length > 1) {
                const roadName = matches[1];
                const regex = new RegExp(`on\\s+${roadName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+on\\s+${roadName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
                gpsInstruction = gpsInstruction.replace(regex, `on ${roadName}`);
            }
            
            // Only add meaningful directions
            if (gpsInstruction && gpsInstruction.length > 3) {
                turnByTurnDirections.push({
                    instruction: gpsInstruction,
                    street: street,
                    distance: distanceKm,
                    distanceMeters: distanceM,
                    type: announcementType,
                    modifier: modifier,
                    stepIndex: idx
                });
                lastStreet = street;
            }
        });
    }
    
    // Fallback directions if no OSRM steps or all filtered out
    if (turnByTurnDirections.length === 0) {
        turnByTurnDirections = [
            { instruction: 'Start navigation', street: '', distance: '0' },
            { instruction: 'Follow the route', street: '', distance: '0' },
            { instruction: 'Arrive at destination', street: '', distance: '0' }
        ];
    }
    
    console.log('Turn-by-turn directions:', turnByTurnDirections);
    
    // Enhanced speak directions using unified voice system
    function speak(text, currentLat = null, currentLng = null) {
        // Enhance instruction with landmarks if coordinates provided
        let enhancedText = text;
        if (currentLat && currentLng) {
            enhancedText = createLandmarkBasedInstruction(currentLat, currentLng, text);
        }
        
        // Use the main speakNavigation function for consistent voice
        speakNavigation(enhancedText, true); // priority = true for navigation instructions
    }
    
    // Get current direction based on progress
    function getCurrentDirection(progress) {
        const dirIndex = Math.floor(progress * (turnByTurnDirections.length - 1));
        return turnByTurnDirections[Math.min(dirIndex, turnByTurnDirections.length - 1)];
    }
    
    // Update directions panel with real turn-by-turn info
    function updatePanel(progress) {
        const panel = document.getElementById('directionsRoute');
        if (panel) {
            const direction = getCurrentDirection(progress);
            const nextDirection = turnByTurnDirections[Math.min(currentStepIndex + 1, turnByTurnDirections.length - 1)];
            
            let instructionText = direction.instruction;
            if (direction.street && direction.street !== 'the road') {
                instructionText += ` on ${direction.street}`;
            }
            
            panel.innerHTML = `
                <div style="background: #4285F4; color: white; padding: 15px; border-radius: 8px; margin-bottom: 10px;">
                    <div style="font-size: 16px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
                        <span><i class="fas fa-location-arrow"></i> GPS Navigation</span>
                        <i class="fas fa-volume-up" style="font-size: 14px; opacity: 0.8;"></i>
                    </div>
                    <div style="font-size: 14px; margin-top: 8px; font-weight: 500;">${instructionText}</div>
                    ${direction.distance > 0 ? `<div style="font-size: 12px; margin-top: 5px; opacity: 0.9;">${direction.distance} km</div>` : ''}
                </div>
                <div style="padding: 10px; background: #f0f0f0; border-radius: 6px;">
                    <div style="display: flex; justify-content: space-between;">
                        <div>Progress: ${Math.round(progress * 100)}%</div>
                        <div>Step ${currentStepIndex + 1}/${turnByTurnDirections.length}</div>
                    </div>
                    ${nextDirection && nextDirection.instruction !== direction.instruction ? `
                    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd; font-size: 12px; color: #666;">
                        <i class="fas fa-arrow-right"></i> Next: ${nextDirection.instruction}${nextDirection.street ? ' on ' + nextDirection.street : ''}
                    </div>
                    ` : ''}
                    <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid #ddd; font-size: 11px; color: #888; text-align: center;">
                        <i class="fas fa-headphones"></i> Voice navigation active
                    </div>
                </div>
            `;
        }
    }
    
    // Start voice navigation with user interaction check
    const startNavigation = () => {
        speak("Starting GPS navigation with landmark guidance.");
        setTimeout(() => {
            const firstDir = turnByTurnDirections[0];
            let intro = firstDir.instruction;
            if (firstDir.street && firstDir.street !== 'the road') {
                intro += ` on ${firstDir.street}`;
            }
            // Pass starting coordinates for landmark detection
            const startCoords = routeCoordinates[0];
            speak(intro, startCoords[0], startCoords[1]);
        }, 500);
    };
    
    // Small delay to ensure browser allows speech after click
    setTimeout(startNavigation, 100);
    
    updatePanel(0);
    
    // GPS Animation loop - synchronized with voice and distance-based timing
    let lastSpokenStep = -1;
    let carStartTime = Date.now();
    let isSpeaking = false;
    let cumulativeDistance = 0; // Track total distance traveled
    let lastSpokenDistance = -1; // Track when we last spoke for distance-based triggers
    let hasAnnouncedArrival = false; // Track if arrival has been announced
    
    // Calculate segment distances for realistic timing
    const segmentDistances = [];
    let totalRouteDistance = 0;
    for (let i = 0; i < routeCoordinates.length - 1; i++) {
        const dist = calculateDistance(
            routeCoordinates[i][0], routeCoordinates[i][1],
            routeCoordinates[i + 1][0], routeCoordinates[i + 1][1]
        );
        segmentDistances.push(dist);
        totalRouteDistance += dist;
    }
    
    // Average car speed: 54 km/h = 15 m/s for realistic urban driving with voice sync
    const carSpeedMPS = 15;
    
    // Estimate time for voice to speak (average 3 words per second)
    function estimateSpeechTime(text) {
        const wordCount = text.split(' ').length;
        return (wordCount / 2.5) * 1000; // milliseconds
    }
    
    function navigateStep() {
        if (currentIndex >= routeCoordinates.length) {
            // Arrived at destination
            if (!hasAnnouncedArrival) {
                hasAnnouncedArrival = true;
                console.log('Car arrived at destination - announcing arrival');
                speak("You have arrived at your destination.");
                showNotification('You have arrived at your destination');
            }
            updatePanel(1);
            return;
        }
        
        const position = routeCoordinates[currentIndex];
        const progress = currentIndex / routeCoordinates.length;
        
        // Calculate current step index
        const stepProgress = Math.floor(progress * turnByTurnDirections.length);
        currentStepIndex = Math.min(stepProgress, turnByTurnDirections.length - 1);
        
        // Move car to current position
        window.carMarker.setLatLng(position);
        
        // Track cumulative distance for precise voice timing
        if (currentIndex > 0) {
            cumulativeDistance += segmentDistances[currentIndex - 1] || 0;
        }
        
        // Smooth map following (only pan every 5 points)
        if (currentIndex % 5 === 0) {
            map.panTo(position);
        }
        
        // Update panel every 20 points
        if (currentIndex % 20 === 0) {
            updatePanel(progress);
        }
        
        // Voice directions at step changes AND precise distance triggers
        const direction = turnByTurnDirections[currentStepIndex];
        const nextDirection = turnByTurnDirections[currentStepIndex + 1];
        
        // Check for precise distance-based triggers (100m, 50m before turns)
        if (nextDirection && (direction.type === 'turn' || direction.type === 'left' || direction.type === 'right')) {
            const remainingDistance = nextDirection.distanceMeters;
            
            // Speak at exactly 100 meters before turn
            if (remainingDistance > 0 && remainingDistance <= 100 && lastSpokenDistance !== 100) {
                lastSpokenDistance = 100;
                const warningText = `In 100 meters, ${direction.instruction}`;
                speak(warningText, position[0], position[1]);
                console.log('100m warning:', warningText);
            }
            // Speak at exactly 50 meters before turn
            else if (remainingDistance > 0 && remainingDistance <= 50 && lastSpokenDistance !== 50) {
                lastSpokenDistance = 50;
                const warningText = `In 50 meters, ${direction.instruction}`;
                speak(warningText, position[0], position[1]);
                console.log('50m warning:', warningText);
            }
        }
        
        // Regular step-based voice directions
        if (currentStepIndex !== lastSpokenStep && currentStepIndex < turnByTurnDirections.length) {
            lastSpokenStep = currentStepIndex;
            isSpeaking = true;
            
            // Build GPS announcement
            let announcement = '';
            
            if (currentStepIndex === 0) {
                announcement = `Starting navigation. ${direction.instruction}`;
                if (direction.distanceMeters > 100) {
                    announcement += ` for ${direction.distance} kilometers.`;
                }
            } else if (direction.type === 'roundabout') {
                announcement = `Approaching roundabout. ${direction.instruction}`;
            } else if (direction.type === 'turn' || direction.type === 'left' || direction.type === 'right') {
                // Calculate remaining distance to next turn
                const remainingDistance = nextDirection ? nextDirection.distanceMeters : 0;
                
                if (remainingDistance > 0 && remainingDistance <= 100) {
                    announcement = `In ${remainingDistance} meters, ${direction.instruction}`;
                } else if (remainingDistance > 100 && remainingDistance <= 200) {
                    announcement = `In ${Math.round(remainingDistance / 50) * 50} meters, ${direction.instruction}`;
                } else if (remainingDistance > 200 && remainingDistance < 1000) {
                    announcement = `In ${Math.round(remainingDistance / 100) * 100} meters, ${direction.instruction}`;
                } else {
                    announcement = direction.instruction;
                    if (direction.distanceMeters > 500) {
                        announcement += `. Continue for ${direction.distance} kilometers.`;
                    } else if (direction.distanceMeters > 100) {
                        announcement += `. Continue for ${direction.distanceMeters} meters.`;
                    }
                }
            } else if (direction.type === 'road_change') {
                announcement = direction.instruction;
            } else if (direction.type === 'straight' && direction.distanceMeters > 1000) {
                if (direction.street && !announcement.includes(direction.street)) {
                    announcement = `Continue on ${direction.street} for ${direction.distance} kilometers.`;
                } else {
                    announcement = `Continue for ${direction.distance} kilometers.`;
                }
            } else if (currentStepIndex === turnByTurnDirections.length - 1 || direction.type === 'arrive') {
                announcement = 'You have arrived at your destination.';
                hasAnnouncedArrival = true; // Mark arrival as announced
            }
            
            if (announcement) {
                console.log('Announcing:', announcement);
                // Pass current position for landmark-based navigation
                speak(announcement, position[0], position[1]);
                
                // Calculate timing to sync car with voice
                const speechTime = estimateSpeechTime(announcement);
                const nextStepDistance = segmentDistances[currentIndex] || 50;
                const timeToNextStep = (nextStepDistance / carSpeedMPS) * 1000;
                
                // For turns and arrivals, pause car until voice finishes so they stay in sync
                if (direction.type === 'turn' || direction.type === 'left' || direction.type === 'right' || 
                    direction.type === 'roundabout' || direction.type === 'arrive' || 
                    currentStepIndex === turnByTurnDirections.length - 1) {
                    const pauseTime = Math.max(0, speechTime - timeToNextStep + 500); // +500ms buffer
                    if (pauseTime > 0) {
                        console.log(`Pausing car for ${pauseTime}ms at turn to sync with voice`);
                        setTimeout(() => { isSpeaking = false; }, speechTime + pauseTime);
                    } else {
                        setTimeout(() => { isSpeaking = false; }, speechTime);
                    }
                } else {
                    setTimeout(() => { isSpeaking = false; }, speechTime);
                }
            }
        }
        
        // Calculate time for this segment based on actual distance
        const segmentDistance = segmentDistances[currentIndex] || 50; // meters
        const segmentTime = Math.max(50, (segmentDistance / carSpeedMPS) * 1000); // milliseconds, min 50ms
        
        currentIndex++;
        setTimeout(navigateStep, segmentTime);
    }
    
    navigateStep();
}

// Simple test function for debugging
window.testCarAnimation = function() {
    console.log('=== TESTING CAR ANIMATION ===');
    
    const testCoords = [
        [-1.2921, 36.8219],
        [-1.2915, 36.8225],
        [-1.2910, 36.8230],
        [-1.2905, 36.8235]
    ];
    
    console.log('Test coordinates:', testCoords);
    
    // Clear any existing car
    if (window.carMarker) {
        map.removeLayer(window.carMarker);
    }
    
    // Create simple car
    const testCar = L.marker(testCoords[0]).addTo(map);
    console.log('Test car created at:', testCoords[0]);
    
    let i = 0;
    function moveTestCar() {
        console.log('Moving test car to index:', i);
        if (i < testCoords.length) {
            testCar.setLatLng(testCoords[i]);
            console.log('Test car moved to:', testCoords[i]);
            i++;
            setTimeout(moveTestCar, 1000);
        } else {
            console.log('Test animation complete');
        }
    }
    
    moveTestCar();
};

// Road network visualization for GPS-style navigation
let roadNetworkLayer = null;
let pathNetworkLayer = null;

// Load and display road network from OpenStreetMap
function loadRoadNetwork() {
    if (!map) {
        console.error('Map not initialized');
        return;
    }
    
    // Get current map bounds (smaller area for faster loading)
    const bounds = map.getBounds();
    const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
    
    // Simplified query - only major roads for better performance
    const overpassQuery = `
        [out:json][timeout:15];
        (
            way["highway"~"^(motorway|primary|secondary|residential)$"](${bbox});
        );
        out geom;
    `;
    
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
    
    console.log('Loading real Kenya roads from OpenStreetMap...');
    
    fetch(overpassUrl)
        .then(response => response.json())
        .then(data => {
            console.log('✅ Real roads loaded:', data.elements.length, 'ways');
            displayRoadNetwork(data.elements);
        })
        .catch(error => {
            console.error('❌ Error loading roads:', error);
            console.log('Roads will load when you zoom/pan the map');
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
            
            let roadStyle;
            if (highwayType === 'motorway') {
                roadStyle = { color: '#4285F4', weight: 5, opacity: 0.8 };
            } else if (highwayType === 'primary') {
                roadStyle = { color: '#1967D2', weight: 3, opacity: 0.7 };
            } else {
                roadStyle = { color: '#5F6368', weight: 2, opacity: 0.6 };
            }
            
            const polyline = L.polyline(coords, roadStyle);
            roadLines.push(polyline);
        }
    });
    
    roadNetworkLayer = L.layerGroup(roadLines).addTo(map);
    console.log(`✅ Displayed ${roadLines.length} real Kenya roads`);
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
    }, 1000);
}

// Categorize facility type for filtering
function categorizeFacility(type) {
    const typeLower = type.toLowerCase();
    
    if (typeLower.includes('hospital') || typeLower.includes('medical') || typeLower.includes('clinic')) {
        return 'health';
    } else if (typeLower.includes('church') || typeLower.includes('cathedral') || typeLower.includes('mosque') || typeLower.includes('temple')) {
        return 'church';
    } else if (typeLower.includes('bank') || typeLower.includes('financial') || typeLower.includes('atm')) {
        return 'financial';
    } else if (typeLower.includes('school') || typeLower.includes('university') || typeLower.includes('college') || typeLower.includes('education')) {
        return 'education';
    } else if (typeLower.includes('hotel') || typeLower.includes('lodge')) {
        return 'hotel';
    } else if (typeLower.includes('restaurant') || typeLower.includes('cafe') || typeLower.includes('bar')) {
        return 'restaurant';
    } else if (typeLower.includes('police') || typeLower.includes('station')) {
        return 'police';
    } else if (typeLower.includes('fire') || typeLower.includes('emergency')) {
        return 'fire';
    } else if (typeLower.includes('library')) {
        return 'library';
    } else if (typeLower.includes('park') || typeLower.includes('garden')) {
        return 'park';
    } else if (typeLower.includes('market') || typeLower.includes('mall')) {
        return 'market';
    } else if (typeLower.includes('airport')) {
        return 'transport';
    } else {
        return 'poi';
    }
}


// Heatmap functionality
let heatmapLayer = null;
let heatmapActive = false;

function toggleHeatmap() {
    console.log('Toggling heatmap...');
    
    if (!map) {
        console.error('Map not initialized');
        showNotification('Map not ready yet');
        return;
    }
    
    if (!facilities || facilities.length === 0) {
        console.error('No facilities loaded');
        showNotification('No facilities to display');
        return;
    }
    
    const heatmapBtn = document.getElementById('heatmapBtn');
    
    if (heatmapActive) {
        // Remove heatmap
        try {
            if (heatmapLayer) {
                map.removeLayer(heatmapLayer);
                heatmapLayer = null;
            }
            heatmapActive = false;
            if (heatmapBtn) heatmapBtn.style.background = '';
            if (heatmapBtn) heatmapBtn.classList.remove('active');
            showNotification('Heatmap disabled');
            console.log('Heatmap disabled');
        } catch(e) {
            console.error('Error disabling heatmap:', e);
        }
    } else {
        // Create heatmap
        try {
            createHeatmap();
            heatmapActive = true;
            if (heatmapBtn) {
                heatmapBtn.style.background = '#FF5722';
                heatmapBtn.classList.add('active');
            }
            showNotification('Heatmap enabled - showing facility density');
            console.log('Heatmap enabled with', facilities.length, 'facilities');
        } catch(e) {
            console.error('Error enabling heatmap:', e);
            showNotification('Failed to enable heatmap');
        }
    }
}

function createHeatmap() {
    // Create intensity points based on facility density
    const heatData = facilities.map(facility => {
        if (!facility.lat || !facility.lng) return null;
        return {
            lat: parseFloat(facility.lat),
            lng: parseFloat(facility.lng),
            intensity: 1.0 // Base intensity for all facilities
        };
    }).filter(point => point !== null);
    
    // Create simple heatmap using circles
    heatmapLayer = L.layerGroup();
    
    heatData.forEach(point => {
        const circle = L.circle([point.lat, point.lng], {
            radius: 300, // 300m radius - much smaller to show individual facility heat
            color: '#FF5722',
            fillColor: '#FF5722',
            fillOpacity: 0.4,
            weight: 1,
            opacity: 0.6
        });
        
        heatmapLayer.addLayer(circle);
    });
    
    heatmapLayer.addTo(map);
}

// Load facilities from CSV
async function loadFacilities() {
    console.log('Loading facilities...');
    facilities = [];
    
    try {
        const response = await fetch('kenya_facilities.csv');
        if (!response.ok) throw new Error('Failed to fetch CSV: ' + response.status);
        
        const csvText = await response.text();
        console.log('CSV fetched, size:', csvText.length, 'bytes');
        const lines = csvText.split('\n');
        console.log('CSV lines:', lines.length);
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            const id = parts[0] || i;
            const name = (parts[1] || 'Unknown').replace(/"/g, '');
            const type = (parts[2] || 'Unknown').replace(/"/g, '');
            const lat = parseFloat(parts[3]);
            const lng = parseFloat(parts[4]);
            const county = (parts[5] || 'Unknown').replace(/"/g, '');
            const address = (parts[6] || '').replace(/"/g, '');
            const phone = (parts[7] || '').replace(/"/g, '');
            const hours = (parts[8] || '').replace(/"/g, '');
            const rating = parseFloat(parts[9]) || 4.0;
            const wheelchair = parts[10] ? parts[10].replace(/"/g, '') === 'TRUE' : false;
            
            if (!isNaN(lat) && !isNaN(lng)) {
                facilities.push({
                    id: id, name: name, type: type,
                    lat: lat, lng: lng, county: county,
                    address: address, phone: phone,
                    hours: hours, rating: rating,
                    wheelchair: wheelchair,
                    category: categorizeFacility(type)
                });
            }
        }
        
        console.log('Loaded ' + facilities.length + ' facilities');
        
        // Update badge
        document.getElementById('facilityCountBadge').textContent = facilities.length;
        
        // Update markers
        updateMarkers();
        
        // Populate dropdown
        populateCountyDropdown();
        
    } catch (error) {
        console.error('Load error:', error);
    } finally {
        // ALWAYS hide loading - no matter what happens above
        console.log('Hiding loading spinner...');
        hideLoading();
    }
}


// Force refresh facilities data
async function forceRefreshFacilities() {
    console.log('Force refreshing facilities...');
    showLoading();
    
    // Clear all existing data
    facilities = [];
    markers = [];
    if (markerCluster) {
        map.removeLayer(markerCluster);
        markerCluster = null;
    }
    
    // Clear browser cache for CSV
    const timestamp = new Date().getTime() + Math.random();
    console.log('Loading with timestamp:', timestamp);
    
    await loadFacilities();
}

// Test function - can be called from console: testRefresh()
window.testRefresh = async function() {
    console.log('Manual test refresh triggered');
    await forceRefreshFacilities();
};


// Update markers for a chunk of facilities
function updateMarkersChunk(chunk) {
    if (!markerCluster) {
        markerCluster = L.markerClusterGroup({
            maxClusterRadius: 80,
            spiderfyOnMaxZoom: false,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true
        });
        map.addLayer(markerCluster);
    }
    
    chunk.forEach(facility => {
        const icon = getFacilityIcon(facility.type);
        const marker = L.marker([facility.lat, facility.lng], { icon: icon });
        
        marker.bindPopup(`
            <div style="min-width: 180px;">
                <h4 style="margin: 0 0 4px 0; color: #2c3e50; font-size: 14px;">${facility.name}</h4>
                <p style="margin: 2px 0; font-size: 12px;"><strong>Type:</strong> ${facility.type}</p>
                <p style="margin: 2px 0; font-size: 12px;"><strong>County:</strong> ${facility.county}</p>
                ${facility.phone ? `<p style="margin: 2px 0; font-size: 12px;"><strong>Phone:</strong> ${facility.phone}</p>` : ''}
                <button onclick="getDirections(${facility.lat}, ${facility.lng})" style="margin-top: 4px; padding: 4px 8px; background: #3498db; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">Directions</button>
            </div>
        `);
        
        marker.facilityData = facility;
        markerCluster.addLayer(marker);
        markers.push(marker);
    });
}

// Update facility list for a chunk (limited to 100 total)
function updateFacilityListChunk(chunk) {
    const facilityList = document.getElementById('facilityList');
    
    // If this is the first chunk, create header
    if (chunk[0] === facilities[0]) {
        facilityList.innerHTML = `
            <div style="padding: 10px; background: #f8f9fa; border-bottom: 1px solid #dee2e6; margin-bottom: 10px; font-weight: bold; color: #5f6368;">
                All Facilities (${Math.min(facilities.length, 100)} shown)
            </div>
        `;
    }
    
    // Use document fragment for better performance
    const fragment = document.createDocumentFragment();
    chunk.forEach(facility => {
        const item = createFacilityItem(facility);
        fragment.appendChild(item);
    });
    facilityList.appendChild(fragment);
}

// Render facility list chunk for optimized loading
function renderFacilityListChunk(chunk) {
    const facilityList = document.getElementById('facilityList');
    
    if (!facilityList) return;
    
    // Use document fragment for better performance
    const fragment = document.createDocumentFragment();
    chunk.forEach(facility => {
        const item = createFacilityItem(facility);
        fragment.appendChild(item);
    });
    
    facilityList.appendChild(fragment);
}

// Smart county detection based on coordinates
function detectCounty(lat, lng, fallbackCity = null) {
    // First try the provided city
    if (fallbackCity && fallbackCity.trim()) {
        return fallbackCity;
    }
    
    // Precise GeoJSON-based lookup if boundary data is available
    if (countyData && countyData.features) {
        for (const feature of countyData.features) {
            const name = feature.properties.name || feature.properties.COUNTY || feature.properties.COUNTY_NAM;
            const geometry = feature.geometry;
            const formattedName = name + (name.toLowerCase().includes('county') ? '' : ' County');
            
            if (geometry.type === 'Polygon') {
                if (isPointInPolygon(lat, lng, geometry.coordinates[0])) return formattedName;
            } else if (geometry.type === 'MultiPolygon') {
                for (const poly of geometry.coordinates) {
                    if (isPointInPolygon(lat, lng, poly[0])) return formattedName;
                }
            }
        }
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

// Populate facility list - Simple and normal
function populateFacilityList() {
    const facilityList = document.getElementById('facilityList');
    facilityList.innerHTML = '';
    
    // Get filter values
    const county = document.getElementById('countySelect').value;
    const facilityType = document.getElementById('facilityTypeSelect').value;
    
    // Filter facilities
    let filtered = facilities;
    
    if (county !== 'all') {
        filtered = filtered.filter(f => f.county === county);
    }
    
    if (facilityType !== 'all') {
        filtered = filtered.filter(f => f.category === facilityType);
    }
    
    // Add header with count
    const header = document.createElement('div');
    header.style.cssText = 'padding: 10px; background: #f8f9fa; border-bottom: 1px solid #dee2e6; margin-bottom: 10px; font-weight: bold; color: #5f6368;';
    
    let headerText = 'Facilities';
    if (county !== 'all' && facilityType !== 'all') {
        headerText = `${facilityType.charAt(0).toUpperCase() + facilityType.slice(1)} Facilities in ${county}`;
    } else if (county !== 'all') {
        headerText = `Facilities in ${county}`;
    } else if (facilityType !== 'all') {
        headerText = `${facilityType.charAt(0).toUpperCase() + facilityType.slice(1)} Facilities`;
    }
    
    header.innerHTML = `${headerText} (${filtered.length} found)`;
    facilityList.appendChild(header);
    
    // Sort and display (limit to 200 for performance)
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    const toDisplay = filtered.slice(0, 200);
    
    toDisplay.forEach(facility => {
        const item = createFacilityItem(facility);
        facilityList.appendChild(item);
    });
}

// Helper function to create facility item HTML
function createFacilityItem(facility) {
    const item = document.createElement('div');
    item.className = 'facility-item';
    
    // Simplified HTML for better performance
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
        <button class="facility-directions-btn" style="margin-top: 8px; padding: 6px 12px; background: #4285F4; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 6px;" onclick="event.stopPropagation(); getDirections(${facility.lat}, ${facility.lng});">
            <i class="fas fa-route"></i> Get Directions
        </button>
    `;
    
    // Add click handler with debouncing (for the whole item except the directions button)
    item.addEventListener('click', (e) => {
        // Don't trigger if clicking the directions button
        if (e.target.closest('.facility-directions-btn')) return;
        
        requestAnimationFrame(() => {
            map.setView([facility.lat, facility.lng], 15);
            // Find and open marker popup (optimized search)
            const marker = markers.find(m => m.facilityData && m.facilityData.id === facility.id);
            if (marker) {
                marker.openPopup();
            }
        });
    });
    
    return item;
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
        // Health
        'Hospital': 'hospital',
        'Clinic': 'clinic-medical',
        'Medical': 'clinic-medical',
        'Health Facility': 'clinic-medical',
        
        // Education
        'School': 'graduation-cap',
        'University': 'university',
        'College': 'user-graduate',
        'Education': 'school',
        
        // Religious
        'Church': 'church',
        'Cathedral': 'church',
        'Mosque': 'mosque',
        'Temple': 'place-of-worship',
        
        // Financial
        'Bank': 'landmark',
        'ATM': 'credit-card',
        'Financial': 'hand-holding-usd',
        
        // Hotels
        'Hotel': 'bed',
        'Lodge': 'house-chimney',
        
        // Food
        'Restaurant': 'utensils',
        'Cafe': 'coffee',
        'Bar': 'beer',
        
        // Services
        'Police Station': 'shield-alt',
        'Fire Station': 'fire-extinguisher',
        'Library': 'book',
        
        // Recreation
        'Park': 'tree',
        'Garden': 'leaf',
        
        // Shopping
        'Market': 'shopping-cart',
        'Mall': 'store',
        
        // Transport
        'Airport': 'plane',
        'Transport': 'route',
        
        // Default
        'Facility': 'map-marker-alt',
        'POI': 'map-marker-alt'
    };
    return icons[type] || 'map-marker-alt';
}

// Update markers - Simple and normal
function updateMarkers() {
    const county = document.getElementById('countySelect').value;
    const facilityType = document.getElementById('facilityTypeSelect').value;
    
    // Filter facilities
    let filtered = facilities;
    
    if (county !== 'all') {
        filtered = filtered.filter(f => f.county === county);
    }
    
    if (facilityType !== 'all') {
        filtered = filtered.filter(f => f.category === facilityType);
    }
    
    // Clear existing markers
    if (markerCluster) {
        map.removeLayer(markerCluster);
        markerCluster = null;
    }
    markers = [];
    
    // Create new cluster if we have facilities
    if (filtered.length > 0) {
        markerCluster = L.markerClusterGroup({
            maxClusterRadius: 80,
            spiderfyOnMaxZoom: false,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true
        });
        
        // Add markers
        filtered.forEach(facility => {
            const icon = getFacilityIcon(facility.type);
            const marker = L.marker([facility.lat, facility.lng], { icon: icon });
            
            marker.bindPopup(`
                <div style="min-width: 180px;">
                    <h4 style="margin: 0 0 4px 0; color: #2c3e50; font-size: 14px;">${facility.name}</h4>
                    <p style="margin: 2px 0; font-size: 12px;"><strong>Type:</strong> ${facility.type}</p>
                    <p style="margin: 2px 0; font-size: 12px;"><strong>County:</strong> ${facility.county}</p>
                    ${facility.phone ? `<p style="margin: 2px 0; font-size: 12px;"><strong>Phone:</strong> ${facility.phone}</p>` : ''}
                    <button onclick="getDirections(${facility.lat}, ${facility.lng})" style="margin-top: 4px; padding: 4px 8px; background: #3498db; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">Directions</button>
                </div>
            `);
            
            marker.facilityData = facility;
            markerCluster.addLayer(marker);
            markers.push(marker);
        });
        
        map.addLayer(markerCluster);
        
        // Show notification
        let notificationText = `Found ${filtered.length} facilities`;
        if (county !== 'all' && facilityType !== 'all') {
            notificationText = `Found ${filtered.length} ${facilityType} facilities in ${county}`;
        } else if (county !== 'all') {
            notificationText = `Found ${filtered.length} facilities in ${county}`;
        } else if (facilityType !== 'all') {
            notificationText = `Found ${filtered.length} ${facilityType} facilities`;
        }
        showNotification(notificationText);
        
        // Fit map to show results
        if (filtered.length > 0) {
            const bounds = L.latLngBounds(filtered.map(f => [f.lat, f.lng]));
            map.fitBounds(bounds.pad(0.1));
        }
    } else {
        showNotification('No facilities found for selected filters');
    }
}

// Render filtered markers in chunks for smooth performance
function renderFilteredMarkersInChunks(facilitiesToShow, totalCount, county, facilityType) {
    const CHUNK_SIZE = 50;
    let currentChunk = 0;
    
    function processChunk() {
        const start = currentChunk * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, facilitiesToShow.length);
        
        if (start >= facilitiesToShow.length) {
            // All chunks processed - finalize
            map.addLayer(markerCluster);
            
            // Show results count
            let notificationText = `Found ${totalCount} facilities`;
            if (totalCount > facilitiesToShow.length) {
                notificationText += ` (showing first ${facilitiesToShow.length})`;
            }
            if (county !== 'all' && facilityType !== 'all') {
                notificationText = `Found ${totalCount} ${facilityType} facilities in ${county}`;
                if (totalCount > facilitiesToShow.length) {
                    notificationText += ` (showing first ${facilitiesToShow.length})`;
                }
            } else if (county !== 'all') {
                notificationText = `Found ${totalCount} facilities in ${county}`;
                if (totalCount > facilitiesToShow.length) {
                    notificationText += ` (showing first ${facilitiesToShow.length})`;
                }
            } else if (facilityType !== 'all') {
                notificationText = `Found ${totalCount} ${facilityType} facilities`;
                if (totalCount > facilitiesToShow.length) {
                    notificationText += ` (showing first ${facilitiesToShow.length})`;
                }
            }
            showNotification(notificationText);
            
            // Fit map to show results
            if (facilitiesToShow.length > 0) {
                const bounds = L.latLngBounds(facilitiesToShow.map(f => [f.lat, f.lng]));
                map.fitBounds(bounds.pad(0.1));
            }
            return;
        }
        
        // Process current chunk
        const chunk = facilitiesToShow.slice(start, end);
        chunk.forEach(facility => {
            const icon = getFacilityIcon(facility.type);
            const marker = L.marker([facility.lat, facility.lng], { icon: icon });
            
            marker.bindPopup(`
                <div style="min-width: 180px;">
                    <h4 style="margin: 0 0 4px 0; color: #2c3e50; font-size: 14px;">${facility.name}</h4>
                    <p style="margin: 2px 0; font-size: 12px;"><strong>Type:</strong> ${facility.type}</p>
                    <p style="margin: 2px 0; font-size: 12px;"><strong>County:</strong> ${facility.county}</p>
                    ${facility.phone ? `<p style="margin: 2px 0; font-size: 12px;"><strong>Phone:</strong> ${facility.phone}</p>` : ''}
                    <button onclick="getDirections(${facility.lat}, ${facility.lng})" style="margin-top: 4px; padding: 4px 8px; background: #3498db; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">Directions</button>
                </div>
            `);
            
            marker.facilityData = facility;
            markerCluster.addLayer(marker);
            markers.push(marker);
        });
        
        currentChunk++;
        
        // Process next chunk using requestAnimationFrame
        requestAnimationFrame(processChunk);
    }
    
    // Start processing chunks
    requestAnimationFrame(processChunk);
}

// Show loading
function showLoading(show = true) {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.style.display = show ? 'flex' : 'none';
    }
}

// Hide loading
function hideLoading() {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.style.display = 'none';
    }
}

// Get directions function
window.getDirections = function(lat, lng) {
    const facility = facilities.find(f => f.lat === lat && f.lng === lng);
    if (facility) {
        showDirectionsFromPopup(lat, lng, facility.name, facility.type);
    }
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
    
    // Create real road route using OSRM (Open Source Routing Machine) with enhanced road following
    try {
        // OSRM API expects [longitude, latitude] order
        // Get detailed road geometry with step-by-step coordinates for real road following
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=true&alternatives=false`;
        console.log('OSRM URL for REAL ROAD route:', osrmUrl);
        console.log('Calculating ACTUAL ROAD route from:', [fromLat, fromLng], 'to:', [toLat, toLng]);
        
        showNotification('Calculating real road route...');
        
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
                    
                    // Extract DETAILED road coordinates from OSRM steps for REAL road following
                    let roadCoordinates = [];
                    
                    // Get detailed coordinates from each step's geometry
                    if (route.legs && route.legs[0] && route.legs[0].steps) {
                        route.legs[0].steps.forEach(step => {
                            if (step.geometry && step.geometry.coordinates) {
                                const stepCoords = step.geometry.coordinates.map(coord => [coord[1], coord[0]]);
                                roadCoordinates = roadCoordinates.concat(stepCoords);
                            }
                        });
                    }
                    
                    // Fallback to route geometry if no step details
                    if (roadCoordinates.length === 0) {
                        roadCoordinates = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
                    }
                    
                    // Remove duplicate consecutive coordinates to prevent backward movement
                    const uniqueCoordinates = [];
                    let lastCoord = null;
                    for (const coord of roadCoordinates) {
                        if (!lastCoord || 
                            Math.abs(coord[0] - lastCoord[0]) > 0.00001 || 
                            Math.abs(coord[1] - lastCoord[1]) > 0.00001) {
                            uniqueCoordinates.push(coord);
                            lastCoord = coord;
                        }
                    }
                    
                    const coordinates = uniqueCoordinates;
                    
                    console.log('DETAILED road coordinates:', coordinates.length, 'points');
                    console.log('Route follows ACTUAL ROAD GEOMETRY with', coordinates.length, 'waypoints');
                    
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
                    
                    // Create route line showing ACTUAL ROAD GEOMETRY
                    const routeLine = L.polyline(coordinates, {
                        color: '#4285F4',
                        weight: 5,
                        opacity: 0.9,
                        smoothFactor: 0.1 // Minimal smoothing to show real road curves
                    }).addTo(map);
                    
                    console.log('ACTUAL ROAD route displayed with', coordinates.length, 'detailed points');
                    
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
                            <div class="step-icon"><i class="fas fa-road"></i></div>
                            <div>
                                <div class="step-text">ACTUAL ROAD route calculated</div>
                                <div class="step-distance">${(route.distance / 1000).toFixed(1)} km following real roads</div>
                            </div>
                        </div>
                        <div style="padding: 10px; background: #e8f5e8; border-radius: 6px; text-align: center; border: 2px solid #4CAF50;">
                            <i class="fas fa-route" style="color: #2e7d32; margin-right: 8px;"></i>
                            <span style="color: #2e7d32; font-size: 14px; font-weight: bold;">Following ACTUAL ROAD GEOMETRY</span>
                            <div style="margin-top: 5px; font-size: 12px; color: #2e7d32;">
                                ${coordinates.length} detailed road points - follows every turn and curve
                            </div>
                            <button onclick="speakNavigation('Following actual road geometry.', true)" 
                                    style="margin-left: 10px; padding: 4px 8px; background: #2e7d32; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
                                Test Voice
                            </button>
                        </div>
                    `;
                    
                    document.getElementById('directionsRoute').innerHTML = directionsHTML;
                    
                    // Start car animation with real turn-by-turn directions
                    if (coordinates && coordinates.length > 1) {
                        const routeSteps = route.legs && route.legs[0] ? route.legs[0].steps : [];
                        animateGPSRoute(coordinates, routeSteps);
                    }
                    
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
                    
                    // Car animation already started above with animateGPSRoute
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
    
    // Fallback route displayed - car animation handled by main function
}

// Old car animation function - DEPRECATED, use animateGPSRoute instead
function animateCarAlongRealRoute_DEPRECATED(coordinates, routeSteps = []) {
    console.warn('animateCarAlongRealRoute is deprecated, use animateGPSRoute instead');
    return; // Disabled to prevent conflicts with animateGPSRoute
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

// Simple search function
function setupSearch() {
    const searchBox = document.getElementById('searchBox');
    const searchResults = document.getElementById('searchResults');
    
    if (!searchBox || !searchResults) return;
    
    let searchTimeout;
    
    searchBox.addEventListener('input', function(e) {
        clearTimeout(searchTimeout);
        const query = e.target.value.toLowerCase().trim();
        
        if (query.length < 3) {
            searchResults.classList.remove('show');
            return;
        }
        
        searchTimeout = setTimeout(() => {
            performSearch(query, searchResults, searchBox);
        }, 300);
    });
    
    // Close results when clicking outside
    document.addEventListener('click', function(e) {
        if (!searchBox.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.classList.remove('show');
        }
    });
}

function performSearch(query, searchResults, searchBox) {
    if (!facilities || facilities.length === 0) return;
    
    const results = facilities.filter(f => 
        f.name.toLowerCase().includes(query) || 
        f.type.toLowerCase().includes(query) ||
        f.county.toLowerCase().includes(query)
    ).slice(0, 10);
    
    if (results.length > 0) {
        searchResults.innerHTML = results.map(f => `
            <div class="search-result-item" data-lat="${f.lat}" data-lng="${f.lng}" data-name="${f.name}" data-type="${f.type}">
                <div class="search-result-name">
                    <i class="fas fa-${getFacilityIconName(f.type)}" style="color: ${facilityColors[f.type] || '#5f6368'}; margin-right: 8px;"></i>
                    ${f.name}
                </div>
                <div class="search-result-type">${f.type} • ${f.county}</div>
            </div>
        `).join('');
        
        searchResults.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', function() {
                const lat = parseFloat(this.dataset.lat);
                const lng = parseFloat(this.dataset.lng);
                const name = this.dataset.name;
                
                map.setView([lat, lng], 15);
                searchResults.classList.remove('show');
                searchBox.value = name;
            });
        });
        
        searchResults.classList.add('show');
    } else {
        searchResults.innerHTML = '<div class="search-result-item">No facilities found</div>';
        searchResults.classList.add('show');
    }
}


// Setup event listeners
function setupEventListeners() {
    console.log('Setting up event listeners...');
    
    // Setup search functionality
    try {
        setupSearch();
        setupCountySearch();
    } catch(e) {
        console.error('Search setup failed:', e);
    }
    
    // Helper function to safely add event listener
    function safeAddListener(id, event, handler) {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener(event, handler);
            console.log(`Listener added for ${id}`);
        } else {
            console.warn(`Element ${id} not found`);
        }
    }
    
    // Toggle sidebar
    safeAddListener('toggleSidebar', 'click', function() {
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('toggleSidebar');
        
        if (sidebar && toggle) {
            sidebar.classList.toggle('hidden');
            toggle.classList.toggle('shifted');
            
            const icon = toggle.querySelector('i');
            if (icon) {
                icon.className = sidebar.classList.contains('hidden') ? 'fas fa-bars' : 'fas fa-times';
            }
        }
    });
    
    // County dropdown change event - with debouncing
    let countyTimeout;
    safeAddListener('countySelect', 'change', function() {
        // Clear existing timeout
        if (countyTimeout) {
            clearTimeout(countyTimeout);
        }
        
        // Debounce for 300ms to prevent unresponsiveness
        countyTimeout = setTimeout(() => {
            if (routingControl) {
                map.removeControl(routingControl);
                routingControl = null;
            }
            populateFacilityList();
            updateMarkers();
        }, 300);
    });
    
    // Facility type dropdown change event - with debouncing
    let facilityTypeTimeout;
    safeAddListener('facilityTypeSelect', 'change', function() {
        // Clear existing timeout
        if (facilityTypeTimeout) {
            clearTimeout(facilityTypeTimeout);
        }
        
        // Debounce for 300ms to prevent unresponsiveness
        facilityTypeTimeout = setTimeout(() => {
            if (routingControl) {
                map.removeControl(routingControl);
                routingControl = null;
            }
            populateFacilityList();
            updateMarkers();
        }, 300);
    });
    
    // Clear filters button
    safeAddListener('clearFiltersBtn', 'click', function() {
        // Reset both dropdowns to 'all'
        const countySelect = document.getElementById('countySelect');
        const facilityTypeSelect = document.getElementById('facilityTypeSelect');
        if (countySelect) countySelect.value = 'all';
        if (facilityTypeSelect) facilityTypeSelect.value = 'all';
        
        // Clear any active routing
        if (routingControl) {
            map.removeControl(routingControl);
            routingControl = null;
        }
        
        // Refresh displays with all facilities
        populateFacilityList();
        updateMarkers();
        
        // Show notification
        showNotification('Filters cleared - showing all facilities');
    });
    
    // Map view buttons
    safeAddListener('mapViewBtn', 'click', function() {
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
        
        // Hide the moving car
        const movingCar = document.getElementById('movingCar');
        if (movingCar) {
            movingCar.style.display = 'none';
        }
    });
    
    // GPS Navigation Mode
    safeAddListener('gpsViewBtn', 'click', function() {
        console.log('GPS button clicked');
        
        // Activate GPS navigation mode
        if (currentLayer !== 'navigation') {
            try {
                map.removeLayer(mapLayers[currentLayer]);
                mapLayers.navigation.addTo(map);
                mapLayers.roads.addTo(map); // Add road overlay for better visibility
                currentLayer = 'navigation';
            } catch(e) {
                console.error('Error switching to navigation layer:', e);
            }
        }
        
        // Add GPS mode classes
        document.body.classList.add('gps-mode', 'gps-navigation-mode');
        
        // Show the moving car animation
        const movingCar = document.getElementById('movingCar');
        if (movingCar) {
            movingCar.style.display = 'flex';
        }
        
        // Update button states
        document.querySelectorAll('.header-btn').forEach(btn => btn.classList.remove('active'));
        this.classList.add('active');
        
        // Only zoom if we have user location, otherwise stay at current view
        if (userLocation) {
            try {
                map.setView([userLocation.lat, userLocation.lng], 15);
            } catch(e) {
                console.error('Error setting map view:', e);
            }
        } else {
            // Try to get user location first
            getUserLocation().then(location => {
                if (location && map) {
                    map.setView([location.lat, location.lng], 15);
                }
            }).catch(err => {
                console.log('Location not available for GPS mode:', err);
                showNotification('Click "My Location" button to enable GPS tracking');
            });
        }
        
        // Start GPS simulation
        try {
            startGPSNavigation();
        } catch(e) {
            console.error('Error starting GPS navigation:', e);
        }

        speakNavigation('GPS Navigation Mode activated', true);
    });

    // Street view button
    safeAddListener('streetBtn', 'click', function() {
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
        
        // Hide the moving car
        const movingCar = document.getElementById('movingCar');
        if (movingCar) {
            movingCar.style.display = 'none';
        }
    });

    // Terrain view button
    safeAddListener('terrainBtn', 'click', function() {
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
        
        // Hide the moving car
        const movingCar = document.getElementById('movingCar');
        if (movingCar) {
            movingCar.style.display = 'none';
        }
    });

    safeAddListener('satelliteBtn', 'click', function() {
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
        
        // Hide the moving car
        const movingCar = document.getElementById('movingCar');
        if (movingCar) {
            movingCar.style.display = 'none';
        }
    });
    
    // Map controls
    safeAddListener('refreshBtn', 'click', function() {
        forceRefreshFacilities();
    });
    
    // Heatmap functionality
    safeAddListener('heatmapBtn', 'click', function() {
        toggleHeatmap();
    });
    
    // Voice navigation toggle
    safeAddListener('voiceToggleBtn', 'click', function() {
        navigationEnabled = !navigationEnabled;
        const btn = this;
        const icon = btn.querySelector('i');
        
        if (navigationEnabled) {
            btn.style.background = '#4CAF50';
            icon.className = 'fas fa-volume-up';
            showNotification('Voice navigation enabled');
            if (speechEngine) {
                speakDirection('Voice navigation activated');
            }
        } else {
            btn.style.background = '#F44336';
            icon.className = 'fas fa-volume-mute';
            showNotification('Voice navigation disabled');
            if (currentSpeech) {
                speechEngine.cancel();
                currentSpeech = null;
            }
        }
    });
    
    // Locate button
    safeAddListener('locateBtn', 'click', function() {
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
    
    // Fullscreen button
    safeAddListener('fullscreenBtn', 'click', function() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
            this.innerHTML = '<i class="fas fa-compress"></i>';
        } else {
            document.exitFullscreen();
            this.innerHTML = '<i class="fas fa-expand"></i>';
        }
    });
    
    // Zoom buttons
    safeAddListener('zoomInBtn', 'click', function() {
        console.log('Zoom In clicked');
        if (map) {
            map.zoomIn();
        } else {
            console.error('Map not initialized');
        }
    });
    
    safeAddListener('zoomOutBtn', 'click', function() {
        console.log('Zoom Out clicked');
        if (map) {
            map.zoomOut();
        } else {
            console.error('Map not initialized');
        }
    });
    
    // Refresh button
    safeAddListener('refreshBtn', 'click', function() {
        console.log('Refresh button clicked!');
        forceRefreshFacilities();
    });
    
    // Directions panel controls
    safeAddListener('hideDirectionsBtn', 'click', function() {
        const directionsPanel = document.getElementById('directionsPanel');
        if (directionsPanel) directionsPanel.classList.remove('show');
    });
    
    safeAddListener('closeDirectionsBtn', 'click', function() {
        const directionsPanel = document.getElementById('directionsPanel');
        if (directionsPanel) directionsPanel.classList.remove('show');
        if (routingControl) {
            map.removeControl(routingControl);
            routingControl = null;
        }
        // Remove route lines and markers
        if (map) {
            map.eachLayer(layer => {
                if (layer instanceof L.Polyline || 
                    (layer instanceof L.Marker && layer.options.icon && 
                     (layer.options.icon.options.className === 'start-marker' || 
                      layer.options.icon.options.className === 'end-marker' ||
                      layer.options.icon.options.className === 'car-marker'))) {
                    map.removeLayer(layer);
                }
            });
        }
    });
    
    safeAddListener('useMyLocationBtn', 'click', function() {
        const startLocationInput = document.getElementById('startLocationInput');
        if (userLocation && startLocationInput) {
            startLocationInput.value = 'My Location';
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

// Initialize map and load facilities normally like a standard map
window.addEventListener('load', function() {
    console.log('=== PAGE LOADED ===');
    
    // Debug: Check if buttons exist immediately
    console.log('zoomInBtn exists:', !!document.getElementById('zoomInBtn'));
    console.log('zoomOutBtn exists:', !!document.getElementById('zoomOutBtn'));
    console.log('mapViewBtn exists:', !!document.getElementById('mapViewBtn'));
    console.log('satelliteBtn exists:', !!document.getElementById('satelliteBtn'));
    console.log('terrainBtn exists:', !!document.getElementById('terrainBtn'));
    
    // Safety net: force-hide loading after 5 seconds no matter what
    setTimeout(function() {
        var loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.style.display = 'none';
    }, 5000);
    
    // Initialize map first
    try {
        initMap();
        console.log('Map initialized OK');
    } catch(e) {
        console.error('initMap failed:', e);
    }
    
    // Setup event listeners
    try {
        setupEventListeners();
        console.log('Event listeners setup complete');
    } catch(e) {
        console.error('setupEventListeners failed:', e);
    }
    
    // Load facilities normally
    try {
        loadFacilities();
        console.log('loadFacilities called OK');
    } catch(e) {
        console.error('loadFacilities failed:', e);
        var loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.style.display = 'none';
    }
});

// Global error handler - hide loading on any uncaught error
window.addEventListener('error', function() {
    var loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'none';
});
