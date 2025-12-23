#!/usr/bin/env python3
"""
Script to add SUPABASE_SERVICE_ROLE_KEY to GitHub repository secrets

Usage:
    python3 scripts/add-github-secret.py

Requires:
    - GITHUB_TOKEN environment variable (or in .env)
    - SUPABASE_SERVICE_ROLE_KEY environment variable (or in .env)
    - PyNaCl library: pip install pynacl
"""

import os
import sys
import json
import base64
import requests
from nacl import encoding, public

# Configuration
REPO_OWNER = 'goonidz'
REPO_NAME = 'purple'
SECRET_NAME = 'SUPABASE_SERVICE_ROLE_KEY'

def load_env():
    """Try to load .env file"""
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass  # dotenv not available

def encrypt_secret(public_key: str, secret_value: str) -> str:
    """Encrypt a secret using GitHub's public key"""
    public_key_bytes = base64.b64decode(public_key)
    public_key_obj = public.PublicKey(public_key_bytes)
    box = public.SealedBox(public_key_obj)
    encrypted = box.encrypt(secret_value.encode('utf-8'))
    return base64.b64encode(encrypted).decode('utf-8')

def main():
    load_env()
    
    github_token = os.getenv('GITHUB_TOKEN')
    service_role_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    
    if not github_token:
        print('❌ Error: GITHUB_TOKEN environment variable is required')
        print('📝 Get a token from: https://github.com/settings/tokens')
        print('   Required scopes: repo, workflow')
        sys.exit(1)
    
    if not service_role_key:
        print('❌ Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required')
        print('📝 Get it from: https://supabase.com/dashboard/project/laqgmqyjstisipsbljha/settings/api')
        print('   Look for "service_role" key (secret)')
        sys.exit(1)
    
    headers = {
        'Authorization': f'token {github_token}',
        'Accept': 'application/vnd.github.v3+json',
    }
    
    # Get public key
    print('📥 Fetching repository public key...')
    response = requests.get(
        f'https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/actions/secrets/public-key',
        headers=headers
    )
    
    if response.status_code != 200:
        print(f'❌ Error fetching public key: {response.status_code}')
        print(response.text)
        sys.exit(1)
    
    public_key_data = response.json()
    print('✅ Public key retrieved')
    
    # Encrypt secret
    print('🔐 Encrypting secret...')
    try:
        encrypted_value = encrypt_secret(public_key_data['key'], service_role_key)
        print('✅ Secret encrypted')
    except Exception as e:
        print(f'❌ Error encrypting secret: {e}')
        print('💡 Make sure PyNaCl is installed: pip install pynacl')
        sys.exit(1)
    
    # Add secret
    print(f'📤 Adding secret {SECRET_NAME} to repository...')
    response = requests.put(
        f'https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/actions/secrets/{SECRET_NAME}',
        headers=headers,
        json={
            'encrypted_value': encrypted_value,
            'key_id': public_key_data['key_id'],
        }
    )
    
    if response.status_code == 201 or response.status_code == 204:
        print(f'✅ Successfully added secret {SECRET_NAME} to GitHub repository!')
        print('🎉 The GitHub Actions workflow will now be able to use this secret.')
    else:
        print(f'❌ Error adding secret: {response.status_code}')
        print(response.text)
        sys.exit(1)

if __name__ == '__main__':
    main()
