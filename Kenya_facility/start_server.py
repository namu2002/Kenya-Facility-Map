import http.server
import socketserver
import webbrowser
import os

# Ensure we are serving from the directory where this script is located
os.chdir(os.path.dirname(os.path.abspath(__file__)))

PORT = 8000
Handler = http.server.SimpleHTTPRequestHandler

print(f"Starting server on port {PORT}...")
print(f"Project URL: http://localhost:{PORT}/kenya_dashboard.html")

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    # Automatically open the browser
    webbrowser.open(f"http://localhost:{PORT}/kenya_dashboard.html")
    httpd.serve_forever()