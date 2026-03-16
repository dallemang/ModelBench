#!/usr/bin/env python3
"""
AI Provider Interface and Implementations for OntoBench
Supports local (Ollama) and remote (OpenAI, Claude) AI providers
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Iterator, Any
import json
import requests
import os
import sys
from dataclasses import dataclass

@dataclass
class ChatMessage:
    """Represents a chat message"""
    role: str  # 'user', 'assistant', 'system'
    content: str
    
class AIProvider(ABC):
    """Abstract base class for AI providers"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.name = self.__class__.__name__.replace("Provider", "").lower()
    
    @abstractmethod
    def chat(self, messages: List[ChatMessage], **kwargs) -> str:
        """Send chat messages and get response"""
        pass
    
    @abstractmethod
    def stream_chat(self, messages: List[ChatMessage], **kwargs) -> Iterator[str]:
        """Send chat messages and get streaming response"""
        pass
    
    @abstractmethod
    def get_models(self) -> List[str]:
        """Get list of available models"""
        pass
    
    @abstractmethod
    def is_available(self) -> bool:
        """Check if provider is available"""
        pass

    def chat_with_tools(self, messages: List[ChatMessage], tools: List[Dict] = None,
                        tool_executor=None, **kwargs):
        """Chat with tool use support. Returns (response_text, tool_calls_list).
        Default implementation ignores tools."""
        return self.chat(messages, **kwargs), []

class OllamaProvider(AIProvider):
    """Ollama local AI provider"""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.base_url = config.get('base_url', 'http://localhost:11434')
        self.model = config.get('model', 'llama2')
    
    def chat(self, messages: List[ChatMessage], **kwargs) -> str:
        """Send chat request to Ollama API"""
        try:
            # Convert messages to Ollama format
            ollama_messages = [{"role": msg.role, "content": msg.content} for msg in messages]
            
            response = requests.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": ollama_messages,
                    "stream": False
                },
                timeout=120
            )
            response.raise_for_status()
            
            result = response.json()
            return result.get("message", {}).get("content", "")
            
        except Exception as e:
            raise Exception(f"Ollama API error: {str(e)}")
    
    def stream_chat(self, messages: List[ChatMessage], **kwargs) -> Iterator[str]:
        """Send streaming chat request to Ollama API"""
        try:
            ollama_messages = [{"role": msg.role, "content": msg.content} for msg in messages]
            
            response = requests.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": ollama_messages,
                    "stream": True
                },
                stream=True,
                timeout=120
            )
            response.raise_for_status()
            
            for line in response.iter_lines():
                if line:
                    try:
                        data = json.loads(line.decode('utf-8'))
                        if "message" in data and "content" in data["message"]:
                            yield data["message"]["content"]
                    except json.JSONDecodeError:
                        continue
                        
        except Exception as e:
            raise Exception(f"Ollama streaming error: {str(e)}")
    
    def get_models(self) -> List[str]:
        """Get available Ollama models"""
        try:
            response = requests.get(f"{self.base_url}/api/tags", timeout=10)
            response.raise_for_status()
            
            result = response.json()
            return [model["name"] for model in result.get("models", [])]
            
        except Exception as e:
            return []
    
    def is_available(self) -> bool:
        """Check if Ollama is running"""
        try:
            response = requests.get(f"{self.base_url}/api/tags", timeout=5)
            print(f"Ollama availability check: {self.base_url}/api/tags -> {response.status_code}", file=sys.stderr)
            return response.status_code == 200
        except Exception as e:
            print(f"Ollama availability check failed: {e}", file=sys.stderr)
            return False

class OpenAIProvider(AIProvider):
    """OpenAI API provider"""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.api_key = config.get('api_key', '')
        self.model = config.get('model', 'gpt-3.5-turbo')
        self.base_url = config.get('base_url', 'https://api.openai.com/v1')
    
    def chat(self, messages: List[ChatMessage], **kwargs) -> str:
        """Send chat request to OpenAI API"""
        if not self.api_key:
            raise Exception("OpenAI API key not configured")
        
        try:
            openai_messages = [{"role": msg.role, "content": msg.content} for msg in messages]
            
            response = requests.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": self.model,
                    "messages": openai_messages,
                    "max_tokens": kwargs.get('max_tokens', 1000),
                    "temperature": kwargs.get('temperature', 0.7)
                },
                timeout=120
            )
            response.raise_for_status()
            
            result = response.json()
            return result["choices"][0]["message"]["content"]
            
        except Exception as e:
            raise Exception(f"OpenAI API error: {str(e)}")
    
    def stream_chat(self, messages: List[ChatMessage], **kwargs) -> Iterator[str]:
        """Send streaming chat request to OpenAI API"""
        if not self.api_key:
            raise Exception("OpenAI API key not configured")
        
        try:
            openai_messages = [{"role": msg.role, "content": msg.content} for msg in messages]
            
            response = requests.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": self.model,
                    "messages": openai_messages,
                    "max_tokens": kwargs.get('max_tokens', 1000),
                    "temperature": kwargs.get('temperature', 0.7),
                    "stream": True
                },
                stream=True,
                timeout=120
            )
            response.raise_for_status()
            
            for line in response.iter_lines():
                if line:
                    line_str = line.decode('utf-8')
                    if line_str.startswith('data: '):
                        data_str = line_str[6:]
                        if data_str.strip() == '[DONE]':
                            break
                        try:
                            data = json.loads(data_str)
                            if "choices" in data and len(data["choices"]) > 0:
                                delta = data["choices"][0].get("delta", {})
                                if "content" in delta:
                                    yield delta["content"]
                        except json.JSONDecodeError:
                            continue
                            
        except Exception as e:
            raise Exception(f"OpenAI streaming error: {str(e)}")
    
    def get_models(self) -> List[str]:
        """Get available OpenAI models"""
        if not self.api_key:
            return []
        
        try:
            response = requests.get(
                f"{self.base_url}/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=10
            )
            response.raise_for_status()
            
            result = response.json()
            models = [model["id"] for model in result.get("data", [])]
            # Filter to chat models
            chat_models = [m for m in models if "gpt" in m.lower()]
            return sorted(chat_models)
            
        except Exception as e:
            return []
    
    def is_available(self) -> bool:
        """Check if OpenAI API is accessible"""
        return bool(self.api_key)

class ClaudeProvider(AIProvider):
    """Anthropic Claude API provider"""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.api_key = config.get('api_key', '')
        self.model = config.get('model', 'claude-3-sonnet-20240229')
        self.base_url = config.get('base_url', 'https://api.anthropic.com/v1')
    
    def chat(self, messages: List[ChatMessage], **kwargs) -> str:
        """Send chat request to Claude API"""
        if not self.api_key:
            raise Exception("Claude API key not configured")
        
        try:
            # Claude expects messages in a specific format
            claude_messages = []
            system_message = None
            
            for msg in messages:
                if msg.role == "system":
                    system_message = msg.content
                else:
                    claude_messages.append({"role": msg.role, "content": msg.content})
            
            payload = {
                "model": self.model,
                "max_tokens": kwargs.get('max_tokens', 1000),
                "messages": claude_messages
            }
            
            if system_message:
                payload["system"] = system_message
            
            response = requests.post(
                f"{self.base_url}/messages",
                headers={
                    "x-api-key": self.api_key,
                    "content-type": "application/json",
                    "anthropic-version": "2023-06-01"
                },
                json=payload,
                timeout=120
            )
            response.raise_for_status()
            
            result = response.json()
            return result["content"][0]["text"]
            
        except Exception as e:
            raise Exception(f"Claude API error: {str(e)}")
    
    def stream_chat(self, messages: List[ChatMessage], **kwargs) -> Iterator[str]:
        """Send streaming chat request to Claude API"""
        if not self.api_key:
            raise Exception("Claude API key not configured")
        
        try:
            claude_messages = []
            system_message = None
            
            for msg in messages:
                if msg.role == "system":
                    system_message = msg.content
                else:
                    claude_messages.append({"role": msg.role, "content": msg.content})
            
            payload = {
                "model": self.model,
                "max_tokens": kwargs.get('max_tokens', 1000),
                "messages": claude_messages,
                "stream": True
            }
            
            if system_message:
                payload["system"] = system_message
            
            response = requests.post(
                f"{self.base_url}/messages",
                headers={
                    "x-api-key": self.api_key,
                    "content-type": "application/json",
                    "anthropic-version": "2023-06-01"
                },
                json=payload,
                stream=True,
                timeout=120
            )
            response.raise_for_status()
            
            for line in response.iter_lines():
                if line:
                    line_str = line.decode('utf-8')
                    if line_str.startswith('data: '):
                        data_str = line_str[6:]
                        try:
                            data = json.loads(data_str)
                            if data.get("type") == "content_block_delta":
                                if "delta" in data and "text" in data["delta"]:
                                    yield data["delta"]["text"]
                        except json.JSONDecodeError:
                            continue
                            
        except Exception as e:
            raise Exception(f"Claude streaming error: {str(e)}")
    
    def chat_with_tools(self, messages: List[ChatMessage], tools: List[Dict] = None,
                        tool_executor=None, **kwargs):
        """Chat with tool use support, handling the full agentic loop.
        Returns (response_text, tool_calls) where tool_calls is a list of
        {"name": ..., "input": ..., "result": ...} dicts."""
        if not self.api_key:
            raise Exception("Claude API key not configured")
        if not tools or not tool_executor:
            return self.chat(messages, **kwargs), []

        try:
            claude_messages = []
            system_message = None
            for msg in messages:
                if msg.role == "system":
                    system_message = msg.content
                else:
                    claude_messages.append({"role": msg.role, "content": msg.content})

            payload = {
                "model": self.model,
                "max_tokens": kwargs.get('max_tokens', 4096),
                "messages": claude_messages,
                "tools": tools
            }
            if system_message:
                payload["system"] = system_message

            all_tool_calls = []

            # Agentic loop: call Claude, execute any tool calls, repeat
            while True:
                response = requests.post(
                    f"{self.base_url}/messages",
                    headers={
                        "x-api-key": self.api_key,
                        "content-type": "application/json",
                        "anthropic-version": "2023-06-01"
                    },
                    json=payload,
                    timeout=120
                )
                response.raise_for_status()
                result = response.json()

                stop_reason = result.get("stop_reason")

                if stop_reason == "tool_use":
                    # Append Claude's response (with tool_use blocks) to the conversation
                    payload["messages"].append({"role": "assistant", "content": result["content"]})

                    # Execute each tool call and collect results
                    tool_results = []
                    for block in result["content"]:
                        if block.get("type") == "tool_use":
                            try:
                                output = tool_executor(block["name"], block["input"])
                            except Exception as e:
                                output = f"Tool error: {str(e)}"
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": block["id"],
                                "content": output
                            })
                            all_tool_calls.append({
                                "name": block["name"],
                                "input": block["input"],
                                "result": output
                            })

                    payload["messages"].append({"role": "user", "content": tool_results})

                else:
                    # end_turn or other: extract text and return
                    for block in result.get("content", []):
                        if block.get("type") == "text":
                            return block["text"], all_tool_calls
                    return "", all_tool_calls

        except Exception as e:
            raise Exception(f"Claude API error: {str(e)}")

    def get_models(self) -> List[str]:
        """Get available Claude models"""
        return [
            "claude-opus-4-6",
            "claude-sonnet-4-6",
            "claude-haiku-4-5-20251001"
        ]
    
    def is_available(self) -> bool:
        """Check if Claude API key is configured"""
        return bool(self.api_key)

# Provider registry
PROVIDERS = {
    'ollama': OllamaProvider,
    'openai': OpenAIProvider,
    'claude': ClaudeProvider
}

def create_provider(provider_type: str, config: Dict[str, Any]) -> AIProvider:
    """Factory function to create AI providers"""
    if provider_type not in PROVIDERS:
        raise ValueError(f"Unknown provider type: {provider_type}")
    
    return PROVIDERS[provider_type](config)