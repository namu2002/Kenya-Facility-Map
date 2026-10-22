# Interactive Web-based GIS for Health, Education and Financial services.

An interactive web-based dashboard for visualizing and analyzing facilities data across Kenya. This project provides a comprehensive mapping solution with advanced features for facility management and analysis.

## Features

### 🗺️ Interactive Mapping
- **Leaflet.js Integration**: High-performance interactive maps
- **Multiple Base Layers**: OpenStreetMap, satellite, and terrain views
- **Marker Clustering**: Efficient visualization of dense facility locations
- **Custom Markers**: Color-coded markers based on facility types

### 📊 Data Visualization
- **Heat Maps**: Density visualization of facility distribution
- **Facility Categories**: Financial services, points of interest, airports, and more
- **Search Functionality**: Real-time facility search with filtering
- **Data Layers**: Toggle different facility categories on/off

### 🛠️ Advanced Features
- **Routing System**: Calculate routes between facilities
- **Nearest Facility Finder**: Find closest facilities to any location
- **Export Capabilities**: Download filtered data as CSV
- **Responsive Design**: Works seamlessly on desktop and mobile devices

## Data Sources

The dashboard utilizes multiple GeoJSON datasets:
- Financial services points across Kenya
- Points of interest and landmarks
- Airport locations and facilities
- Additional facility data from various sources

## Technologies Used

### Frontend
- **HTML5**: Semantic markup and structure
- **CSS3**: Modern styling with animations and transitions
- **JavaScript (ES6+)**: Core functionality and interactions

### Libraries & Frameworks
- **Leaflet.js**: Interactive mapping library
- **Leaflet.markercluster**: Marker clustering for performance
- **Leaflet Routing Machine**: Route calculation and display
- **Leaflet.heat**: Heat map visualization
- **Font Awesome**: Icon library
- **Google Fonts**: Typography

### Data Formats
- **GeoJSON**: Geospatial data format
- **CSV**: Tabular facility data

## Project Structure

```
Kenya_facility/
├── data/                           # Geospatial data files
│   ├── hotosm_ken_financial_services_points_geojson.geojson
│   ├── hotosm_ken_points_of_interest_points_geojson.geojson
│   ├── kenya_airports.geojson
│   └── [additional GeoJSON files]
├── index.html                      # Entry point (redirects to dashboard)
├── kenya_dashboard.html           # Main dashboard application
├── script.js                      # Core JavaScript functionality
├── styles.css                     # Application styling
├── kenya_facilities.csv           # Facility data in CSV format
└── README.md                      # Project documentation
```

## Getting Started

### Prerequisites
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Local web server (optional, for development)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/kenya-facilities-map.git
   cd kenya-facilities-map
   ```

2. **Open the application**
   - Simply open `index.html` in your web browser
   - For development, use a local server:
     ```bash
     # Using Python
     python -m http.server 8000
     
     # Using Node.js
     npx serve .
     
     # Using PHP
     php -S localhost:8000
     ```

3. **Access the dashboard**
   - Navigate to `http://localhost:8000` (if using a local server)
   - Or directly open `index.html` in your browser

## Usage

### Basic Navigation
- **Pan**: Click and drag the map
- **Zoom**: Use mouse wheel or zoom controls
- **Search**: Use the search box to find specific facilities
- **Layers**: Toggle different facility categories using layer controls

### Advanced Features
- **Find Nearest**: Click on the map to find nearest facilities
- **Route Planning**: Select two points to calculate routes
- **Data Export**: Use export buttons to download filtered data
- **Heat Maps**: Toggle heat map view for density analysis

## Customization

### Adding New Data
1. Place GeoJSON files in the `data/` directory
2. Update `script.js` to include new data layers
3. Add corresponding layer controls in the HTML

### Styling
- Modify `styles.css` for visual customization
- Update marker colors and icons in the JavaScript
- Adjust map themes and layer styles

### Functionality
- Extend `script.js` for new features
- Add new analysis tools and filters
- Implement additional export formats

## Performance Considerations

- **Marker Clustering**: Automatically groups nearby markers for better performance
- **Lazy Loading**: Data loads progressively to improve initial load time
- **Responsive Design**: Optimized for various screen sizes
- **Caching**: Browser caching enabled for static assets

## Browser Compatibility

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- **Leaflet.js**: For the excellent mapping library
- **OpenStreetMap**: For providing base map data
- **HOTOSM**: For the Kenya facility datasets
- **Font Awesome**: For the icon library

## Contact

JOY NJAPIT - joynjapit8@gmail.com
Project Link: https://github.com/namu2002/kenya-facilities-map(https://github.com/namu2002/kenya-facility-map)

---

**Note:** This project uses external CDNs for some libraries, so an internet connection is required to load those resources. Map tiles and routing services may also depend on the availability of their respective providers.
