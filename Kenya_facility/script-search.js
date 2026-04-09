// Search functionality
let searchResults = [];
let searchIndex = null;

// Initialize search functionality
function initSearch() {
    const searchBox = document.getElementById('searchBox');
    if (!searchBox) return;

    // Build search index
    buildSearchIndex();

    // Add search event listeners
    searchBox.addEventListener('input', debounce(handleSearch, 300));
    searchBox.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    });
}

// Build search index for fast searching
function buildSearchIndex() {
    if (!window.allFacilities) return;

    searchIndex = window.allFacilities.map((facility, index) => ({
        index: index,
        name: facility.name.toLowerCase(),
        type: facility.type ? facility.type.toLowerCase() : '',
        category: facility.category ? facility.category.toLowerCase() : '',
        address: facility.address ? facility.address.toLowerCase() : '',
        facility: facility
    }));
}

// Handle search input
function handleSearch() {
    const searchBox = document.getElementById('searchBox');
    const query = searchBox.value.trim().toLowerCase();
    
    if (!query) {
        clearSearchResults();
        return;
    }

    const results = performSearch(query);
    displaySearchResults(results);
}

// Perform search
function performSearch(query) {
    if (!searchIndex) return [];

    const terms = query.split(/\s+/).filter(term => term.length > 0);
    
    const scoredResults = searchIndex.map(item => {
        let score = 0;
        
        terms.forEach(term => {
            // Exact name match gets highest score
            if (item.name === term) score += 100;
            else if (item.name.includes(term)) score += 50;
            
            // Type matches
            if (item.type === term) score += 30;
            else if (item.type.includes(term)) score += 15;
            
            // Category matches
            if (item.category === term) score += 20;
            else if (item.category.includes(term)) score += 10;
            
            // Address matches
            if (item.address.includes(term)) score += 5;
        });
        
        return { ...item, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20); // Limit to top 20 results

    return scoredResults;
}

// Display search results
function displaySearchResults(results) {
    const resultsContainer = document.getElementById('searchResults');
    if (!resultsContainer) return;

    searchResults = results;
    
    if (results.length === 0) {
        resultsContainer.innerHTML = '<div class="no-results">No facilities found</div>';
        resultsContainer.style.display = 'block';
        return;
    }

    resultsContainer.innerHTML = '';
    
    results.forEach(result => {
        const resultItem = document.createElement('div');
        resultItem.className = 'search-result-item';
        
        resultItem.innerHTML = `
            <div class="result-icon">
                <i class="${getFacilityIconClass(result.facility.category, result.facility.type)}"></i>
            </div>
            <div class="result-info">
                <h4>${highlightMatch(result.facility.name, result.score)}</h4>
                <p class="result-type">${result.facility.type}</p>
                <p class="result-category">${result.facility.category}</p>
                ${result.facility.address ? `<p class="result-address">${result.facility.address}</p>` : ''}
            </div>
            <div class="result-actions">
                <button class="btn-view" onclick="viewSearchResult(${result.index})">
                    <i class="fas fa-eye"></i> View
                </button>
                <button class="btn-directions" onclick="getDirections(${result.facility.lat}, ${result.facility.lng})">
                    <i class="fas fa-directions"></i>
                </button>
            </div>
        `;
        
        resultItem.addEventListener('click', () => viewSearchResult(result.index));
        resultsContainer.appendChild(resultItem);
    });
    
    resultsContainer.style.display = 'block';
}

// Highlight matching text
function highlightMatch(text, score) {
    if (score >= 100) {
        return `<strong>${text}</strong>`;
    }
    return text;
}

// Get facility icon class
function getFacilityIconClass(category, type) {
    const iconClasses = {
        'Financial Services': 'fas fa-university',
        'Points of Interest': 'fas fa-landmark',
        'Airports': 'fas fa-plane',
        'Other': 'fas fa-map-marker-alt'
    };
    
    return iconClasses[category] || iconClasses['Other'];
}

// View search result
function viewSearchResult(index) {
    const result = searchResults[index];
    if (!result) return;
    
    const facility = result.facility;
    selectedFacility = facility;
    updateFacilityInfo(facility);
    
    // Center map on facility
    map.setView([facility.lat, facility.lng], 15);
    
    // Open popup
    const markers = markerCluster.getLayers();
    markers.forEach(marker => {
        if (marker.facilityData && marker.facilityData.id === facility.id) {
            marker.openPopup();
        }
    });
    
    // Clear search results
    clearSearchResults();
    
    // Clear search box
    const searchBox = document.getElementById('searchBox');
    if (searchBox) {
        searchBox.value = '';
    }
}

// Clear search results
function clearSearchResults() {
    const resultsContainer = document.getElementById('searchResults');
    if (resultsContainer) {
        resultsContainer.innerHTML = '';
        resultsContainer.style.display = 'none';
    }
    searchResults = [];
}

// Advanced search with filters
function performAdvancedSearch(filters) {
    if (!window.allFacilities) return [];

    return window.allFacilities.filter(facility => {
        // Category filter
        if (filters.categories && filters.categories.length > 0) {
            if (!filters.categories.includes(facility.category)) {
                return false;
            }
        }
        
        // Type filter
        if (filters.types && filters.types.length > 0) {
            if (!filters.types.includes(facility.type)) {
                return false;
            }
        }
        
        // Text search
        if (filters.query && filters.query.trim()) {
            const query = filters.query.toLowerCase();
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
        
        // Location filter (within radius)
        if (filters.location && filters.radius) {
            const distance = filters.location.distanceTo([facility.lat, facility.lng]);
            if (distance > filters.radius) {
                return false;
            }
        }
        
        return true;
    });
}

// Debounce function for search
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

// Close search results when clicking outside
document.addEventListener('click', (e) => {
    const searchContainer = document.querySelector('.search-container');
    const resultsContainer = document.getElementById('searchResults');
    
    if (searchContainer && resultsContainer && 
        !searchContainer.contains(e.target) && 
        resultsContainer.style.display === 'block') {
        clearSearchResults();
    }
});

// Keyboard navigation for search results
document.addEventListener('keydown', (e) => {
    if (searchResults.length === 0) return;
    
    const resultsContainer = document.getElementById('searchResults');
    const items = resultsContainer.querySelectorAll('.search-result-item');
    if (items.length === 0) return;
    
    let currentIndex = -1;
    items.forEach((item, index) => {
        if (item.classList.contains('selected')) {
            currentIndex = index;
        }
    });
    
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            currentIndex = Math.min(currentIndex + 1, items.length - 1);
            updateSearchSelection(items, currentIndex);
            break;
            
        case 'ArrowUp':
            e.preventDefault();
            currentIndex = Math.max(currentIndex - 1, 0);
            updateSearchSelection(items, currentIndex);
            break;
            
        case 'Enter':
            e.preventDefault();
            if (currentIndex >= 0) {
                viewSearchResult(searchResults[currentIndex].index);
            }
            break;
            
        case 'Escape':
            clearSearchResults();
            const searchBox = document.getElementById('searchBox');
            if (searchBox) {
                searchBox.blur();
            }
            break;
    }
});

// Update search selection
function updateSearchSelection(items, selectedIndex) {
    items.forEach((item, index) => {
        if (index === selectedIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}
