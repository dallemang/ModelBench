#!/usr/bin/env python3
"""
AI Configuration Management for OntoBench
Handles provider selection, API keys, and settings
"""

import json
import os
from typing import Dict, Any, Optional
from dataclasses import dataclass, asdict

@dataclass
class AIConfig:
    """AI configuration data structure"""
    active_provider: str = "ollama"
    providers: Dict[str, Dict[str, Any]] = None
    
    def __post_init__(self):
        if self.providers is None:
            self.providers = {
                "ollama": {
                    "base_url": "http://localhost:11434",
                    "model": "phi3.5:latest", 
                    "enabled": True
                },
                "openai": {
                    "api_key": "",
                    "model": "gpt-3.5-turbo",
                    "base_url": "https://api.openai.com/v1",
                    "enabled": False
                },
                "claude": {
                    "api_key": "",
                    "model": "claude-3-sonnet-20240229",
                    "base_url": "https://api.anthropic.com/v1",
                    "enabled": False
                }
            }

class AIConfigManager:
    """Manages AI configuration loading and saving"""
    
    def __init__(self, config_file: str = "ai_config.json"):
        self.config_file = config_file
        self.config_path = os.path.join(os.path.dirname(__file__), config_file)
        self._config = None
    
    def load_config(self) -> AIConfig:
        """Load configuration from file"""
        if self._config is None:
            try:
                if os.path.exists(self.config_path):
                    with open(self.config_path, 'r') as f:
                        data = json.load(f)
                        self._config = AIConfig(**data)
                else:
                    # Create default config
                    self._config = AIConfig()
                    self.save_config()
            except Exception as e:
                print(f"Warning: Failed to load AI config: {e}")
                self._config = AIConfig()
        
        return self._config
    
    def save_config(self) -> bool:
        """Save configuration to file"""
        try:
            if self._config is None:
                return False
            
            with open(self.config_path, 'w') as f:
                json.dump(asdict(self._config), f, indent=2)
            return True
        except Exception as e:
            print(f"Error saving AI config: {e}")
            return False
    
    def update_config(self, updates: Dict[str, Any]) -> bool:
        """Update configuration with new values"""
        try:
            config = self.load_config()
            
            # Update active provider
            if "active_provider" in updates:
                config.active_provider = updates["active_provider"]
            
            # Update provider configurations
            if "providers" in updates:
                for provider_name, provider_config in updates["providers"].items():
                    if provider_name in config.providers:
                        config.providers[provider_name].update(provider_config)
                    else:
                        config.providers[provider_name] = provider_config
            
            return self.save_config()
        except Exception as e:
            print(f"Error updating AI config: {e}")
            return False
    
    def get_active_provider_config(self) -> Optional[Dict[str, Any]]:
        """Get configuration for the currently active provider"""
        config = self.load_config()
        if config.active_provider in config.providers:
            return config.providers[config.active_provider]
        return None
    
    def get_provider_config(self, provider_name: str) -> Optional[Dict[str, Any]]:
        """Get configuration for a specific provider"""
        config = self.load_config()
        return config.providers.get(provider_name)
    
    def set_active_provider(self, provider_name: str) -> bool:
        """Set the active AI provider"""
        config = self.load_config()
        if provider_name in config.providers:
            config.active_provider = provider_name
            return self.save_config()
        return False
    
    def is_provider_enabled(self, provider_name: str) -> bool:
        """Check if a provider is enabled"""
        provider_config = self.get_provider_config(provider_name)
        return provider_config and provider_config.get("enabled", False)
    
    def set_provider_enabled(self, provider_name: str, enabled: bool) -> bool:
        """Enable or disable a provider"""
        return self.update_config({
            "providers": {
                provider_name: {"enabled": enabled}
            }
        })
    
    def update_provider_config(self, provider_name: str, config_updates: Dict[str, Any]) -> bool:
        """Update configuration for a specific provider"""
        return self.update_config({
            "providers": {
                provider_name: config_updates
            }
        })

# Global config manager instance
config_manager = AIConfigManager()