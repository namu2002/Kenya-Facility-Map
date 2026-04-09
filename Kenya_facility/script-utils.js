// Utility functions and helpers

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
        { name: "Mount Kenya", lat: -0.1522, lng: 37.3084, type: "mountain", description: "highest mountain in Kenya" },
        { name: "Lake Turkana", lat: 3.6000, lng: 36.2500, type: "lake", description: "largest lake in Kenya" },
        { name: "Masai Mara", lat: -1.5000, lng: 35.0000, type: "reserve", description: "famous game reserve" },
        { name: "Amboseli National Park", lat: -2.6500, lng: 37.2500, type: "park", description: "national park with elephants" }
    ]
};

// Calculate distance between two points (Haversine formula)
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

// Format distance for display
function formatDistance(distance) {
    if (distance < 1000) {
        return `${Math.round(distance)} m`;
    } else {
        return `${(distance / 1000).toFixed(1)} km`;
    }
}

// Get directions between two points
function getDirections(lat, lng) {
    if (!userLocation) {
        // Get user location first
        map.locate({ setView: true, maxZoom: 16 });
        showNotification('Getting your location...', 'info');
        return;
    }

    // Remove existing route
    if (window.routeControl) {
        map.removeControl(window.routeControl);
    }

    // Create routing control
    window.routeControl = L.Routing.control({
        waypoints: [
            L.latLng(userLocation.lat, userLocation.lng),
            L.latLng(lat, lng)
        ],
        routeWhileDragging: true,
        addWaypoints: false,
        createMarker: function() { return null; }, // Don't create markers
        lineOptions: {
            styles: [{ color: '#3b82f6', weight: 4, opacity: 0.7 }]
        }
    }).on('routesfound', function(e) {
        const routes = e.routes;
        const summary = routes[0].summary;
        showNotification(`Distance: ${formatDistance(summary.totalDistance)}, Time: ${formatTime(summary.totalTime)}`, 'success');
    }).addTo(map);

    // Center map on route
    const bounds = L.latLngBounds([
        [userLocation.lat, userLocation.lng],
        [lat, lng]
    ]);
    map.fitBounds(bounds, { padding: [50, 50] });
}

// Format time for display
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}

// Share facility information
function shareFacility(facility) {
    const shareText = `Check out ${facility.name} - ${facility.type} in Kenya`;
    const shareUrl = `https://www.google.com/maps?q=${facility.lat},${facility.lng}`;
    
    if (navigator.share) {
        navigator.share({
            title: facility.name,
            text: shareText,
            url: shareUrl
        }).catch(err => console.log('Error sharing:', err));
    } else {
        // Fallback - copy to clipboard
        const textToCopy = `${shareText}\n${shareUrl}`;
        navigator.clipboard.writeText(textToCopy).then(() => {
            showNotification('Facility information copied to clipboard', 'success');
        }).catch(err => {
            console.error('Error copying to clipboard:', err);
            showNotification('Unable to share facility', 'error');
        });
    }
}

// Show notification
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas ${getNotificationIcon(type)}"></i>
            <span>${message}</span>
        </div>
        <button class="notification-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

// Get notification icon based on type
function getNotificationIcon(type) {
    const icons = {
        'success': 'fa-check-circle',
        'error': 'fa-exclamation-circle',
        'warning': 'fa-exclamation-triangle',
        'info': 'fa-info-circle'
    };
    return icons[type] || icons['info'];
}

// Export filtered data
function exportData(format = 'csv') {
    if (!window.allFacilities || window.allFacilities.length === 0) {
        showNotification('No data to export', 'error');
        return;
    }

    // Get filtered facilities (based on active layers)
    const filteredFacilities = window.allFacilities.filter(f => activeLayers.has(f.category));
    
    if (format === 'csv') {
        exportToCSV(filteredFacilities);
    } else if (format === 'json') {
        exportToJSON(filteredFacilities);
    } else if (format === 'geojson') {
        exportToGeoJSON(filteredFacilities);
    }
}

// Export to CSV
function exportToCSV(facilities) {
    const headers = ['Name', 'Type', 'Category', 'Latitude', 'Longitude', 'Address', 'Phone', 'Email'];
    const csvContent = [
        headers.join(','),
        ...facilities.map(f => [
            `"${f.name || ''}"`,
            `"${f.type || ''}"`,
            `"${f.category || ''}"`,
            f.lat || '',
            f.lng || '',
            `"${f.address || ''}"`,
            `"${f.phone || ''}"`,
            `"${f.email || ''}"`
        ].join(','))
    ].join('\n');

    downloadFile(csvContent, 'kenya_facilities.csv', 'text/csv');
}

// Export to JSON
function exportToJSON(facilities) {
    const jsonContent = JSON.stringify(facilities, null, 2);
    downloadFile(jsonContent, 'kenya_facilities.json', 'application/json');
}

// Export to GeoJSON
function exportToGeoJSON(facilities) {
    const geojson = {
        type: 'FeatureCollection',
        features: facilities.map(f => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [f.lng, f.lat]
            },
            properties: {
                name: f.name,
                type: f.type,
                category: f.category,
                address: f.address,
                phone: f.phone,
                email: f.email,
                source: f.source
            }
        }))
    };

    const jsonContent = JSON.stringify(geojson, null, 2);
    downloadFile(jsonContent, 'kenya_facilities.geojson', 'application/json');
}

// Download file helper
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
    showNotification(`Data exported as ${filename}`, 'success');
}

// Find nearest landmark
function findNearestLandmark(lat, lng) {
    let nearestLandmark = null;
    let minDistance = Infinity;

    // Search all landmarks
    Object.values(kenyaLandmarks).flat().forEach(landmark => {
        const distance = calculateDistance(lat, lng, landmark.lat, landmark.lng);
        if (distance < minDistance) {
            minDistance = distance;
            nearestLandmark = { ...landmark, distance };
        }
    });

    return nearestLandmark;
}

// Get current location
function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy
                });
            },
            (error) => {
                reject(error);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });
}

// Format coordinates for display
function formatCoordinates(lat, lng) {
    return `${lat.toFixed(6)}°${lat >= 0 ? 'N' : 'S'}, ${lng.toFixed(6)}°${lng >= 0 ? 'E' : 'W'}`;
}

// Validate coordinates
function isValidCoordinates(lat, lng) {
    return !isNaN(lat) && !isNaN(lng) && 
           lat >= -90 && lat <= 90 && 
           lng >= -180 && lng <= 180;
}

// Get bounds for Kenya
function getKenyaBounds() {
    return {
        north: 5.0,
        south: -5.0,
        east: 42.0,
        west: 33.0
    };
}

// Check if point is in Kenya
function isInKenya(lat, lng) {
    const bounds = getKenyaBounds();
    return lat <= bounds.north && lat >= bounds.south && 
           lng <= bounds.east && lng >= bounds.west;
}

// Generate random color
function generateRandomColor() {
    return '#' + Math.floor(Math.random()*16777215).toString(16);
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
