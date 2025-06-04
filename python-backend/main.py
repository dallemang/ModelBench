#!/usr/bin/env python3
"""
Simple Python backend for Tauri app
"""

import sys
import json
import os

def process_file(file_path):
    """Process a file and return information about it"""
    try:
        if not os.path.exists(file_path):
            return {"error": "File does not exist"}
        
        file_stats = os.stat(file_path)
        return {
            "path": file_path,
            "size": file_stats.st_size,
            "modified": file_stats.st_mtime,
            "exists": True
        }
    except Exception as e:
        return {"error": str(e)}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command provided"}))
        return
    
    command = sys.argv[1]
    
    if command == "process_file" and len(sys.argv) > 2:
        file_path = sys.argv[2]
        result = process_file(file_path)
        print(json.dumps(result))
    else:
        print(json.dumps({"error": "Unknown command"}))

if __name__ == "__main__":
    main()