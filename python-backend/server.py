#!/usr/bin/env python3
"""
HTTP Server Backend for OntoBench - stateful RDF management using FastAPI
"""

import sys
import json
import os
import re
import uuid
from typing import Optional, List
import tempfile
import shutil
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from rdflib import Graph, Dataset, URIRef, Literal, BNode
from rdflib.namespace import RDF, RDFS, OWL

# Import existing functions and global state from main.py
from main import (
    scan_for_base_declaration,
    find_base_uri_from_graph,
    find_base_uri,
    load_into_dataset_with_base_detection,
    find_owl_imports,
    resolve_relative_import_path,
    load_imports_recursive,
    clear_namespace_registry,
    register_namespaces_from_graph,
    get_global_namespaces,
    load_rdf_file,
    load_rdf_directory,
    get_graph_info,
    query_graph,
    build_ontology_context_for_ai,
    clear_dataset
)

# Import global state from main.py
import main

# Import hierarchy functions from hierarchy.py
from hierarchy import (
    build_class_hierarchy_from_dataset,
    build_import_hierarchy_from_dataset,
    get_label,
    get_class_properties
)

# Import AI functionality
try:
    from ai_providers import create_provider, ChatMessage, PROVIDERS
    from ai_config import config_manager
    AI_AVAILABLE = True
    print("DEBUG: AI providers imported successfully", file=sys.stderr)
except ImportError as e:
    AI_AVAILABLE = False
    print(f"AI providers not available - missing dependencies: {e}", file=sys.stderr)

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Frontend is same-origin in production; open for local dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request models
class LoadRdfRequest(BaseModel):
    file_path: str

class QueryRequest(BaseModel):
    sparql_query: str

class AddTripleRequest(BaseModel):
    subject: str
    predicate: str
    object: str

# AI-related request models
class ChatRequest(BaseModel):
    messages: List[dict]
    provider: Optional[str] = None
    max_tokens: Optional[int] = 1000
    temperature: Optional[float] = 0.7

class AIConfigRequest(BaseModel):
    active_provider: Optional[str] = None
    providers: Optional[dict] = None

@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "dataset_loaded": main.current_dataset is not None}

@app.post("/load_rdf")
def load_rdf_file_endpoint(request: LoadRdfRequest):
    """Load an RDF file into the dataset"""
    try:
        print(f"DEBUG: Loading RDF file: {request.file_path}", file=sys.stderr)
        result = load_rdf_file(request.file_path)
        print(f"DEBUG: After loading, main.current_dataset = {main.current_dataset}", file=sys.stderr)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load RDF file: {str(e)}")

@app.post("/upload_rdf")
async def upload_rdf_file_endpoint(file: UploadFile = File(...)):
    """Load an RDF file uploaded from the browser."""
    suffix = os.path.splitext(file.filename)[1] if file.filename else '.ttl'
    if not suffix:
        suffix = '.ttl'
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        result = load_rdf_file(tmp_path)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)

@app.post("/upload_directory")
async def upload_directory_endpoint(
    files: List[UploadFile] = File(...),
    paths: List[str] = Form(...)
):
    """Load an ontology from a directory uploaded by the browser.

    The browser sends each file under the key 'files' and the corresponding
    webkitRelativePath under the key 'paths', preserving the directory tree.
    """
    temp_dir = tempfile.mkdtemp()
    try:
        for file, rel_path in zip(files, paths):
            dest = os.path.join(temp_dir, rel_path)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, 'wb') as f:
                f.write(await file.read())
        result = load_rdf_directory(temp_dir)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@app.get("/graph_info")
def get_graph_info_endpoint():
    """Get information about the currently loaded dataset"""
    result = get_graph_info()
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@app.post("/clear_dataset")
def clear_dataset_endpoint():
    """Clear the current dataset"""
    try:
        clear_dataset()
        return {"success": True, "message": "Dataset cleared successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear dataset: {str(e)}")

@app.post("/query")
def query_graph_endpoint(request: QueryRequest):
    """Execute a SPARQL query on the current dataset"""
    result = query_graph(request.sparql_query)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@app.post("/add_triple")
def add_triple(request: AddTripleRequest):
    """Add a triple to the dataset"""
    if main.current_dataset is None:
        raise HTTPException(status_code=400, detail="No dataset currently loaded")
    
    try:
        # Find which graph the subject is defined in
        subject_graph_uri = None
        subject_uriref = URIRef(request.subject)
        
        for graph in main.current_dataset.graphs():
            # Look for where the subject is defined (has any rdf:type)
            if (subject_uriref, RDF.type, None) in graph:
                subject_graph_uri = graph.identifier
                break
        
        if subject_graph_uri is None:
            raise HTTPException(status_code=400, detail=f"Subject {request.subject} not found in any graph")
        
        # Add the triple to the subject's graph
        subject_graph = main.current_dataset.graph(subject_graph_uri)
        predicate_uriref = URIRef(request.predicate)
        object_uriref = URIRef(request.object)
        
        # Add the triple: subject predicate object
        subject_graph.add((subject_uriref, predicate_uriref, object_uriref))
        
        return {
            "success": True,
            "subject": request.subject,
            "predicate": request.predicate,
            "object": request.object,
            "graph_uri": str(subject_graph_uri)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add triple: {str(e)}")

@app.get("/hierarchy")
def get_current_hierarchy():
    """Get the current class hierarchy from the dataset"""
    if main.current_dataset is None:
        raise HTTPException(status_code=400, detail="No dataset currently loaded")
    
    try:
        # Build and return the current hierarchy
        current_hierarchy = build_class_hierarchy_from_dataset(main.current_dataset)
        
        return {
            "success": True,
            "hierarchy": current_hierarchy
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get hierarchy: {str(e)}")

@app.get("/import_hierarchy")
def get_current_import_hierarchy():
    """Get the current import hierarchy from the dataset"""
    import time
    
    start_time = time.time()
    
    if main.current_dataset is None:
        print("❌ DEBUG: No dataset loaded", file=sys.stderr)
        raise HTTPException(status_code=400, detail="No dataset currently loaded")
    
    try:
        
        # Build and return the current import hierarchy
        current_import_hierarchy = build_import_hierarchy_from_dataset(main.current_dataset)
        
        elapsed = time.time() - start_time
        
        return {
            "success": True,
            "hierarchy": current_import_hierarchy
        }
        
    except Exception as e:
        print(f"💥 DEBUG: Exception in import hierarchy: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to get import hierarchy: {str(e)}")

@app.get("/resolve_import_path")
def resolve_import_path_endpoint(base_file_path: str, base_uri: str, import_uri: str):
    """Resolve relative import path using the three parameters"""
    try:
        resolved_path, error = resolve_relative_import_path(base_file_path, base_uri, import_uri)
        
        if error:
            return {
                "success": False,
                "error": error,
                "resolved_path": None
            }
        
        return {
            "success": True,
            "resolved_path": resolved_path,
            "error": None
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to resolve import path: {str(e)}")

@app.get("/dump")
def dump_dataset():
    """Return the entire dataset as TriG format for browser viewing"""
    if main.current_dataset is None:
        raise HTTPException(status_code=400, detail="No dataset currently loaded")
    
    try:
        # Serialize the entire dataset to TriG format
        trig_content = main.current_dataset.serialize(format='trig')
        
        # Return as plain text with proper content type
        return PlainTextResponse(
            content=trig_content, 
            media_type="text/plain",
            headers={"Content-Disposition": "inline; filename=dataset.trig"}
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to dump dataset: {str(e)}")

# SPARQL tool definition for AI tool use
SPARQL_TOOLS = [
    {
        "name": "run_sparql_query",
        "description": (
            "Execute a SPARQL SELECT or ASK query against the loaded ontology dataset. "
            "Use this to look up specific classes, properties, relationships, instances, "
            "or any other information that is not already in the ontology summary above."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "A valid SPARQL SELECT or ASK query"
                }
            },
            "required": ["query"]
        }
    }
]

def sparql_tool_executor(tool_name: str, tool_input: dict) -> str:
    """Execute a tool call from the AI and return the result as a string."""
    if tool_name != "run_sparql_query":
        return f"Unknown tool: {tool_name}"

    query = tool_input.get("query", "").strip()
    if not query:
        return "Error: empty query"

    result = query_graph(query)
    if "error" in result:
        return f"Query error: {result['error']}"
    if not result["results"]:
        return "Query returned no results."

    lines = []
    if result["variables"]:
        lines.append(" | ".join(result["variables"]))
        lines.append("-" * 40)
    for row in result["results"][:50]:
        if isinstance(row, dict):
            lines.append(" | ".join(str(v) if v is not None else "" for v in row.values()))
        else:
            lines.append(str(row))
    if result["count"] > 50:
        lines.append(f"... ({result['count']} total results, showing first 50)")
    return "\n".join(lines)


# AI Endpoints

@app.get("/ai/providers")
def get_ai_providers():
    """Get list of available AI providers and their status"""
    if not AI_AVAILABLE:
        raise HTTPException(status_code=503, detail="AI functionality not available")
    
    try:
        config = config_manager.load_config()
        providers_status = {}
        
        for provider_name in PROVIDERS.keys():
            provider_config = config.providers.get(provider_name, {})
            print(f"Checking provider {provider_name} with config: {provider_config}", file=sys.stderr)
            try:
                provider = create_provider(provider_name, provider_config)
                is_available = provider.is_available()
                print(f"Provider {provider_name} availability: {is_available}", file=sys.stderr)
                providers_status[provider_name] = {
                    "available": is_available,
                    "enabled": provider_config.get("enabled", False),
                    "model": provider_config.get("model", ""),
                    "models": provider.get_models() if is_available else []
                }
                print(f"Provider {provider_name} final status: {providers_status[provider_name]}", file=sys.stderr)
            except Exception as e:
                print(f"Error with provider {provider_name}: {e}", file=sys.stderr)
                providers_status[provider_name] = {
                    "available": False,
                    "enabled": False,
                    "error": str(e),
                    "models": []
                }
        
        return {
            "success": True,
            "active_provider": config.active_provider,
            "providers": providers_status
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get providers: {str(e)}")

@app.post("/ai/chat")
def ai_chat(request: ChatRequest):
    """Send chat message to AI provider"""
    print("DEBUG: AI chat request received", file=sys.stderr)
    print(f"DEBUG: AI_AVAILABLE = {AI_AVAILABLE}", file=sys.stderr)
    if not AI_AVAILABLE:
        print("DEBUG: AI not available, returning 503", file=sys.stderr)
        raise HTTPException(status_code=503, detail="AI functionality not available")
    
    try:
        config = config_manager.load_config()
        provider_name = request.provider or config.active_provider
        
        if provider_name not in PROVIDERS:
            raise HTTPException(status_code=400, detail=f"Unknown provider: {provider_name}")
        
        provider_config = config.providers.get(provider_name, {})
        if not provider_config.get("enabled", False):
            raise HTTPException(status_code=400, detail=f"Provider {provider_name} is not enabled")
        
        # Create provider instance
        provider = create_provider(provider_name, provider_config)
        
        if not provider.is_available():
            raise HTTPException(status_code=503, detail=f"Provider {provider_name} is not available")
        
        # Convert request messages to ChatMessage objects
        messages = [ChatMessage(role=msg["role"], content=msg["content"]) for msg in request.messages]
        
        # Add ontology context if dataset is loaded
        print(f"DEBUG: Checking if dataset is loaded for AI context", file=sys.stderr)
        print(f"DEBUG: len(messages) = {len(messages)}", file=sys.stderr)
        if len(messages) > 0:
            print("DEBUG: Building ontology context for AI", file=sys.stderr)
            ontology_ttl = build_ontology_context_for_ai()
            print(f"DEBUG: Ontology context built, length: {len(ontology_ttl) if ontology_ttl else 0}", file=sys.stderr)
            if ontology_ttl:
                # Get the user's prompt (last message should be from user)
                last_message = messages[-1]
                if last_message.role == "user":
                    # Create the combined prompt with ontology context
                    combined_prompt = f"Here is the currently loaded ontology:\n\n{ontology_ttl}\n\n{last_message.content}"
                    # Replace the user's message with the combined prompt
                    messages[-1] = ChatMessage(role="user", content=combined_prompt)
                    
                    # Debug: Save the prompt to a file for review
                    try:
                        debug_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "debug_prompt.txt"))
                        print(f"DEBUG: Attempting to write debug file to: {debug_file}", file=sys.stderr)
                        with open(debug_file, 'w', encoding='utf-8') as f:
                            f.write("=== FULL PROMPT SENT TO AI ===\n\n")
                            for i, msg in enumerate(messages):
                                f.write(f"Message {i+1} ({msg.role}):\n")
                                f.write(msg.content)
                                f.write("\n\n" + "="*50 + "\n\n")
                        print(f"DEBUG: Prompt successfully saved to {debug_file}", file=sys.stderr)
                    except Exception as e:
                        print(f"ERROR: Could not save debug prompt: {e}", file=sys.stderr)
                        print(f"ERROR: Attempted path: {debug_file if 'debug_file' in locals() else 'undefined'}", file=sys.stderr)
        
        # Send to AI, offering SPARQL tool if a dataset is loaded
        if main.current_dataset is not None:
            response, tool_calls = provider.chat_with_tools(
                messages,
                tools=SPARQL_TOOLS,
                tool_executor=sparql_tool_executor,
                max_tokens=request.max_tokens,
                temperature=request.temperature
            )
        else:
            response = provider.chat(
                messages,
                max_tokens=request.max_tokens,
                temperature=request.temperature
            )
            tool_calls = []

        return {
            "success": True,
            "provider": provider_name,
            "content": response,
            "tool_calls": tool_calls
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"AI chat error: {error_details}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"AI chat error: {str(e)}")

@app.get("/ai/config")
def get_ai_config():
    """Get current AI configuration"""
    if not AI_AVAILABLE:
        raise HTTPException(status_code=503, detail="AI functionality not available")
    
    try:
        config = config_manager.load_config()
        
        # Don't expose API keys in the response
        safe_config = {
            "active_provider": config.active_provider,
            "providers": {}
        }
        
        for provider_name, provider_config in config.providers.items():
            safe_provider_config = provider_config.copy()
            # Mask API keys
            if "api_key" in safe_provider_config:
                api_key = safe_provider_config["api_key"]
                if api_key:
                    safe_provider_config["api_key"] = api_key[:8] + "..." if len(api_key) > 8 else "***"
                else:
                    safe_provider_config["api_key"] = ""
            safe_config["providers"][provider_name] = safe_provider_config
        
        return safe_config
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get config: {str(e)}")

@app.post("/ai/config")
def update_ai_config(request: AIConfigRequest):
    """Update AI configuration"""
    if not AI_AVAILABLE:
        raise HTTPException(status_code=503, detail="AI functionality not available")
    
    try:
        updates = {}
        
        if request.active_provider is not None:
            if request.active_provider not in PROVIDERS:
                raise HTTPException(status_code=400, detail=f"Unknown provider: {request.active_provider}")
            updates["active_provider"] = request.active_provider
        
        if request.providers is not None:
            updates["providers"] = request.providers
        
        success = config_manager.update_config(updates)
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update configuration")
        
        return {"success": True, "message": "Configuration updated"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Configuration update error: {str(e)}")

# Serve the built frontend from ../dist if it exists (production / local web mode)
_dist_dir = os.path.join(os.path.dirname(__file__), '..', 'dist')
if os.path.isdir(_dist_dir):
    app.mount("/", StaticFiles(directory=_dist_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn

    # Railway (and most cloud platforms) inject PORT as an env var
    port = int(os.environ.get('PORT', sys.argv[1] if len(sys.argv) > 1 else 8000))

    print(f"Starting OntoBench server on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")