/**
 * ContextStudioController
 * Enterprise Logic for SAP Context Orchestration
 */
class ContextStudioController {
    constructor() {
        // State management for compiled context chunks
        this.currentMemoryChunks = [];
        this.config = null;
        
        // Retrieve the last active profile from local storage, fallback to Default
        this.activeProfileName = localStorage.getItem('sap-active-profile') || "Default Profile";
        
        // The master system prompt containing strict coding standards
        this.defaultPrompt = `=== SYSTEM INSTRUCTIONS ===
Acknowledge receipt of the following context by responding only with 'ACK_READY'. Do not provide analysis, summaries, or feedback until explicitly requested.
You are strictly forbidden from outputting any text other than the Handshake Code: ACK_READY

You are an Expert SAP Architect and Master ABAP Developer.
I am providing you with the full context of my current project.

=== INGESTION GUARDRAIL (STRICT PROTOCOL) ===
CONDITION: If any incoming message contains headers like "--- FILE: " or "CHUNK [number] of [total]".
MANDATORY ACTION: 
  1. SILENTLY STORE the provided content in your internal session memory.
  2. TERMINATE all generative processes. Do not analyze, greet, or offer architectural feedback.

CODING STANDARDS:
1. NO TRUNCATION: Output the full, complete file every time. Always comment code when generating and make it as modular, human-readable, and maintainable as possible.
2. CLEAN ABAP: No Hungarian notation (No LV_, LT_, LS_). Use intention-revealing names.
3. OO SYNTAX MANDATE: Strictly adhere to multi-line global class definitions.
===========================`;

        // Load saved profiles from LocalStorage or initialize as empty.
        const savedProfiles = localStorage.getItem('sap-context-builder-profiles');
        this.variants = savedProfiles ? JSON.parse(savedProfiles) : {};

        // Bootstrap the application and inject the toast container
        this.initToastContainer();
        this.init();
    }

    /**
     * Initializes the dynamic Toast Notification container for enterprise feedback.
     */
    initToastContainer() {
        this.toastContainer = document.createElement('div');
        this.toastContainer.id = 'enterprise-toast-container';
        Object.assign(this.toastContainer.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            zIndex: '9999'
        });
        document.body.appendChild(this.toastContainer);
    }

    /**
     * Displays a transient toast message to the user.
     * @param {string} message - The message to display.
     * @param {string} type - 'success', 'error', or 'info'.
     */
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        
        // Base styling for the toast
        Object.assign(toast.style, {
            minWidth: '250px',
            padding: '12px 20px',
            borderRadius: '4px',
            color: '#fff',
            fontFamily: 'sans-serif',
            fontSize: '14px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            opacity: '0',
            transform: 'translateY(20px)',
            transition: 'all 0.3s ease-in-out',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
        });

        // Apply specific colors based on the feedback type
        if (type === 'success') toast.style.backgroundColor = '#2e7d32'; 
        else if (type === 'error') toast.style.backgroundColor = '#d32f2f'; 
        else toast.style.backgroundColor = '#1976d2'; 

        toast.innerText = message;
        this.toastContainer.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        // Animate out and remove after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    /**
     * Encrypts and saves the GitHub PAT to the secure AES-256 local vault.
     * Triggered by the "Save to Secure Local Vault" button.
     */
    async saveSecureToken() {
        const tokenInput = document.getElementById('globalPatInput');
        
        if (!tokenInput || !tokenInput.value.trim()) {
            this.showToast("Action denied: Please enter a valid token first.", "error");
            return;
        }

        const tokenValue = tokenInput.value.trim();
        this.showToast("Initiating secure encryption...", "info");

        try {
            const res = await fetch('/api/credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: tokenValue })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Failed to communicate with Security Manager");
            }

            // Success feedback
            this.showToast("Success: Token encrypted and locked in vault.", "success");
            
            // Security Best Practice: Wipe the UI input after encryption
            tokenInput.value = '';

        } catch (error) {
            console.error("[Security Error]", error);
            this.showToast(`Vault Error: ${error.message}`, "error");
        }
    }

    /**
     * Bootstraps the UI, fetches config, hydrates defaults, and loads the active profile.
     */
    async init() {
        this.showToast("Initializing Workspace...", "info");
        
        // 1. Fetch backend config first
        await this.fetchConfig(); 
        
        // 2. If no saved profiles exist, construct the "Default Profile" using live config rules
        if (Object.keys(this.variants).length === 0) {
            const defaultExtensions = [];
            
            if (this.config && this.config.uiExtensionGroups) {
                this.config.uiExtensionGroups.forEach(group => {
                    group.items.forEach(item => {
                        if (item.default) {
                            defaultExtensions.push(...item.value.split(','));
                        }
                    });
                });
            }

            this.variants["Default Profile"] = {
                sources: [{type: 'local', path: ''}], 
                prompt: this.defaultPrompt, 
                extensions: defaultExtensions 
            };
        }
        
        if (!this.variants[this.activeProfileName]) {
            this.activeProfileName = Object.keys(this.variants)[0] || "Default Profile";
        }
        
        this.refreshVariantList();
        this.loadVariant();
    }

    /**
     * Fetches the server-side config.json to populate UI extension checkboxes.
     */
    async fetchConfig() {
        try {
            const res = await fetch('/api/config');
            this.config = await res.json();
            
            const extContainer = document.getElementById('extGroup');
            if (extContainer) {
                extContainer.innerHTML = ''; 
                this.config.uiExtensionGroups.forEach(group => {
                    const header = document.createElement('h4');
                    header.innerText = group.groupName;
                    extContainer.appendChild(header);

                    group.items.forEach(item => {
                        const lbl = document.createElement('label');
                        lbl.innerHTML = `<input type="checkbox" value="${item.value}" ${item.default ? 'checked' : ''}> ${item.label}`;
                        extContainer.appendChild(lbl);
                    });
                });
            }


        } catch (e) {
            this.showToast("Failed to load configuration from server.", "error");
        }
    }

    /**
     * Appends a new repository/source input row to the UI.
     */
    addSourceRow(sourceType, sourcePath) {
        const container = document.getElementById('sourcesContainer');
        if (!container) return;

        const rowDiv = document.createElement('div');
        rowDiv.className = 'source-row';
        rowDiv.dataset.type = sourceType;
        
        rowDiv.innerHTML = `
            <div style="flex:1; display:flex; gap:8px;">
                <select class="src-type">
                    <option value="local" ${sourceType === 'local' ? 'selected' : ''}>Local</option>
                    <option value="github" ${sourceType === 'github' ? 'selected' : ''}>GitHub</option>
                </select>
                <input type="text" class="primary-input" value="${sourcePath}" placeholder="Path/URL...">
            </div>
            <button class="danger" onclick="this.closest('.source-row').remove(); App.checkGitHubUI();">X</button>
        `;

        rowDiv.querySelector('.src-type').addEventListener('change', (e) => {
            rowDiv.dataset.type = e.target.value;
            this.checkGitHubUI();
        });

        container.appendChild(rowDiv);
        this.checkGitHubUI();
    }

    /**
     * Toggles the visibility of the GitHub PAT input section based on active sources.
     */
    checkGitHubUI() {
        const authSection = document.getElementById('githubAuthSection');
        if (!authSection) return;

        const hasGithub = Array.from(document.querySelectorAll('.source-row')).some(row => row.dataset.type === 'github');
        authSection.style.display = hasGithub ? 'block' : 'none';
    }

    /**
     * Gathers all UI parameters and sends them to the Node backend for context compilation.
     */
    async compileContext() {
        const sources = Array.from(document.querySelectorAll('.source-row')).map(row => ({
            type: row.dataset.type, 
            path: row.querySelector('.primary-input').value
        })).filter(src => src.path.trim() !== "");
        
        if (!sources.length) {
            this.showToast("Please add at least one source before packing.", "error");
            return;
        }
        
        const extensions = Array.from(document.querySelectorAll('#extGroup input:checked'))
            .flatMap(el => el.value.split(','));

        const packBtn = document.getElementById('packBtn');
        if (packBtn) packBtn.disabled = true;
        
        this.showToast("Compiling context payload...", "info");

        try {
            const aiPromptElement = document.getElementById('aiPrompt');
            const res = await fetch('/api/pack', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ 
                    sources, 
                    extensions, 
                    aiPrompt: aiPromptElement ? aiPromptElement.value : '' 
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Compilation failed");

            this.currentMemoryChunks = data.chunks;
            this.renderChunksToUI();
            
            this.showToast("Context successfully compiled!", "success");
            
            const autoFeedBtn = document.getElementById('autoFeedBtn');
            if (this.config && this.config.enableAutoFeed && autoFeedBtn) {
                autoFeedBtn.style.display = "block";
            }
        } catch (error) { 
            this.showToast(`Error: ${error.message}`, "error"); 
        } finally { 
            if (packBtn) packBtn.disabled = false; 
        }
    }

    /**
     * Renders compiled XML chunks as cards in the UI for easy manual copying.
     */
    renderChunksToUI() {
        const container = document.getElementById('chunks-display');
        if (!container) return;
        
        container.innerHTML = "";
        this.currentMemoryChunks.forEach((chunk, index) => {
            const card = document.createElement('div');
            card.className = 'chunk-card';
            card.innerHTML = `
                <div class="chunk-header">
                    <span class="chunk-title">CHUNK ${index + 1}</span>
                    <button class="secondary" style="width:auto; padding:4px 10px;" onclick="App.copyChunk(this, ${index})">COPY</button>
                </div>
                <div class="chunk-body">${chunk.substring(0, 300).replace(/</g, '&lt;')}...</div>
            `;
            container.appendChild(card);
        });
    }

    /**
     * Copies a specific chunk to the user's OS clipboard and provides button feedback.
     */
    copyChunk(btn, idx) { 
        navigator.clipboard.writeText(this.currentMemoryChunks[idx])
            .then(() => {
                const orig = btn.innerText; 
                btn.innerText = "COPIED!"; 
                this.showToast(`Chunk ${idx + 1} copied to clipboard`, "success");
                setTimeout(() => btn.innerText = orig, 2000); 
            })
            .catch(() => this.showToast("Failed to copy to clipboard", "error"));
    }

    /**
     * Repopulates the profile dropdown menu.
     */
    refreshVariantList() {
        const select = document.getElementById('variantSelect');
        if (!select) return;

        select.innerHTML = Object.keys(this.variants)
            .map(key => `<option value="${key}">${key}</option>`).join('');
        select.value = this.activeProfileName;
    }

    /**
     * Loads the selected profile's settings into the active UI fields.
     */
    loadVariant() { 
        const select = document.getElementById('variantSelect');
        if (!select) return;

        const selected = select.value;
        const data = this.variants[selected];
        if (!data) return;
        
        this.activeProfileName = selected;
        localStorage.setItem('sap-active-profile', selected);
        
        const sourcesContainer = document.getElementById('sourcesContainer');
        if (sourcesContainer) {
            sourcesContainer.innerHTML = ''; 
            data.sources.forEach(src => this.addSourceRow(src.type, src.path)); 
        }
        
        const aiPrompt = document.getElementById('aiPrompt');
        if (aiPrompt) aiPrompt.value = data.prompt || ''; 
        
        const checks = document.querySelectorAll('#extGroup input');
        checks.forEach(chk => {
            chk.checked = data.extensions.some(e => chk.value.includes(e));
        });
    }

    /**
     * Updates the currently active profile with the current UI settings.
     */
    saveVariant() { 
        const name = this.activeProfileName;
        this._persistProfile(name);
        this.showToast(`Profile "${name}" saved successfully.`, "success");
    }

    /**
     * Creates a new profile with the current UI settings.
     */
    saveAsVariant() {
        const name = prompt("Enter new profile name:");
        if (!name || name.trim() === "") {
            this.showToast("Save cancelled: Name cannot be empty.", "info");
            return;
        }
        
        const cleanName = name.trim();
        this._persistProfile(cleanName);
        this.activeProfileName = cleanName;
        localStorage.setItem('sap-active-profile', this.activeProfileName);
        
        this.refreshVariantList();
        this.showToast(`New profile "${cleanName}" created and saved.`, "success");
    }

    /**
     * Deletes the currently active profile (preventing deletion of the Default).
     */
    deleteVariant() {
        const name = this.activeProfileName;

        if (name === "Default Profile") {
            this.showToast("Action denied: The Default Profile cannot be deleted.", "error");
            return;
        }

        if (!confirm(`Are you sure you want to permanently delete the profile "${name}"?`)) {
            return;
        }

        delete this.variants[name];
        localStorage.setItem('sap-context-builder-profiles', JSON.stringify(this.variants));

        this.activeProfileName = "Default Profile";
        localStorage.setItem('sap-active-profile', this.activeProfileName);

        this.refreshVariantList();
        this.loadVariant();
        this.showToast(`Profile "${name}" was successfully deleted.`, "success");
    }

    /**
     * Internal helper to serialize UI state into the variants object.
     */
    _persistProfile(name) {
        const aiPrompt = document.getElementById('aiPrompt');
        this.variants[name] = { 
            sources: Array.from(document.querySelectorAll('.source-row')).map(row => ({
                type: row.dataset.type, 
                path: row.querySelector('.primary-input').value
            })), 
            prompt: aiPrompt ? aiPrompt.value : '', 
            extensions: Array.from(document.querySelectorAll('#extGroup input:checked')).flatMap(el => el.value.split(','))
        }; 
        localStorage.setItem('sap-context-builder-profiles', JSON.stringify(this.variants)); 
    }



    /**
     * Downloads the entire generated XML payload as a file.
     */
    downloadAll() {
        if (!this.currentMemoryChunks || this.currentMemoryChunks.length === 0) {
            this.showToast("Nothing to download. Please pack the context first.", "error");
            return;
        }
        
        const payload = '<?xml version="1.0" encoding="UTF-8"?>\n<sap_context_dump>\n' + this.currentMemoryChunks.join('\n') + '\n</sap_context_dump>';
        const blob = new Blob([payload], { type: 'application/xml' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'sap_context_build.xml';
        link.click();
        
        this.showToast("Download started.", "success");
    }
}

// Global Export for UI Event Listeners
window.App = new ContextStudioController();