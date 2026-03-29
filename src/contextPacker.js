const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const crypto = require('crypto');

/**
 * Enterprise Context Orchestration Engine
 * Compiles local and remote repositories into compressed XML payloads.
 */
class ContextPacker {
    
    /**
     * Master orchestration method. Routes sources to their specific handlers,
     * extracts namespaces, limits file sizes, and compiles the final chunked array.
     */
 /**
     * Master orchestration method. Routes sources to their specific handlers,
     * extracts namespaces, limits file sizes, and compiles the final chunked array.
     */
    static async compile(sources, extensions, aiPrompt, gitHubToken, maxChars = 90000, ignoreDirs = [], ignoreFiles = [], maxFileSizeBytes = 128000) {
        const fileManifest = []; 
        const repositoryNames = []; // NEW: Array to track explicit distinct repos

        for (const source of sources) {
            let sourcePrefix = '';

            if (source.type === 'local') {
                sourcePrefix = path.basename(path.resolve(source.path));
                repositoryNames.push(sourcePrefix);
                
                await this._readLocalDirectory(source.path, source.path, extensions, fileManifest, ignoreDirs, ignoreFiles, maxFileSizeBytes, 0, sourcePrefix);
            } else if (source.type === 'github') {
                const urlObj = new URL(source.path);
                sourcePrefix = path.basename(urlObj.pathname, '.git');
                repositoryNames.push(sourcePrefix);
                
                await this._handleGitHubSource(source.path, extensions, fileManifest, gitHubToken, ignoreDirs, ignoreFiles, maxFileSizeBytes, sourcePrefix);
            }
        }

        // Generate the Architectural Tree Map
        const treeMap = this._generateTreeMap(fileManifest);
        
        // CRITICAL FIX: Explicitly declare the distinct repositories to the LLM
        let repoListText = repositoryNames.map(name => `- ${name}`).join('\n');
        
        const enhancedPrompt = `${aiPrompt}

=== INCLUDED REPOSITORIES ===
The following distinct repositories have been aggregated into this context:
${repoListText}

=== REPOSITORY ARCHITECTURE ===
${treeMap}`;

        return this._packIntoChunks(fileManifest, enhancedPrompt, maxChars);
    }

    /**
     * Clones and processes remote GitHub repositories using strict security protocols.
     * Enforces temporary path containment and guarantees safe teardown.
     */
    static async _handleGitHubSource(repoUrl, extensions, fileManifest, token, ignoreDirs, ignoreFiles, maxFileSizeBytes, sourcePrefix) {
        let parsedUrl;
        try {
            parsedUrl = new URL(repoUrl);
            if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
                throw new Error("Invalid protocol. Only HTTP/HTTPS protocols are permitted.");
            }
        } catch (error) {
            throw new Error(`[Security] Invalid repository URL format: ${repoUrl}`);
        }

        // Generate a cryptographically secure, unpredictable directory name
        const secureId = crypto.randomBytes(16).toString('hex');
        const tempDirName = `sap-builder-${secureId}`;
        const tempDirPath = path.join(os.tmpdir(), tempDirName);

        // Absolute containment check
        if (!tempDirPath.startsWith(os.tmpdir())) {
            throw new Error(`[Security] Path traversal attempt detected. Target: ${tempDirPath}`);
        }

        let authenticatedUrl = repoUrl;
        if (token && parsedUrl.protocol === 'https:') {
            authenticatedUrl = `https://${encodeURIComponent(token)}@${parsedUrl.host}${parsedUrl.pathname}`;
        }

        try {
            console.log(`[GitHub] Initiating secure clone for ${parsedUrl.host}${parsedUrl.pathname}...`);
            // Shallow clone minimizes disk I/O and network latency
            execSync(`git clone --depth 1 "${authenticatedUrl}" "${tempDirPath}"`, { stdio: 'ignore' });
            
            // Pass the extracted GitHub repo name and file size limit down to the directory reader
            await this._readLocalDirectory(tempDirPath, tempDirPath, extensions, fileManifest, ignoreDirs, ignoreFiles, maxFileSizeBytes, 0, sourcePrefix);
            
        } catch (error) {
            console.error(`[GitHub Error] Failed to process ${parsedUrl.host}${parsedUrl.pathname}:`, error.message);
            throw new Error(`Repository clone failed. Verify your URL and OS Keychain PAT.`);
        } finally {
            // Trigger the enterprise gatekeeper for destruction
            await this._safeCleanup(tempDirPath);
        }
    }

    /**
     * Recursively traverses local directories to extract targeted files.
     * Contains built-in guards against infinite loops, root-level scans, limits file sizes, and namespaces the output.
     */
    static async _readLocalDirectory(basePath, currentPath, allowedExtensions, fileManifest, ignoreDirs, ignoreFiles, maxFileSizeBytes, depth = 0, sourcePrefix = "unknown-repo") {
        const maxDepthLimit = 15;
        
        // Block catastrophic root directory scans (e.g., C:\ or /)
        const isRootPath = currentPath.trim().match(/^([a-zA-Z]:\\|\/)$/);
        if (isRootPath) {
            throw new Error(`Critical Safety Halt: Scanning the root directory (${currentPath}) is prohibited.`);
        }

        // Prevent runaway recursion depth mapping
        if (depth > maxDepthLimit) {
            console.warn(`[Packer Warning] Maximum directory depth reached at: ${currentPath}`);
            return;
        }

        try {
            const directoryEntries = await fs.readdir(currentPath, { withFileTypes: true });
            
            for (const entry of directoryEntries) {
                const lowerCaseName = entry.name.toLowerCase();
                const fullPath = path.join(currentPath, entry.name);

                if (lowerCaseName.startsWith('.') || ignoreDirs.includes(lowerCaseName)) {
                    continue; 
                }

                // Optimization: Bypass minified outputs and standard library bundles
                if (/\.min\./i.test(fullPath) || /[\\/]lib[\\/]/i.test(fullPath) || /[\\/]library[\\/]/i.test(fullPath)) {
                    continue;
                }

                if (entry.isDirectory()) {
                    await this._readLocalDirectory(basePath, fullPath, allowedExtensions, fileManifest, ignoreDirs, ignoreFiles, maxFileSizeBytes, depth + 1, sourcePrefix);
                } else if (entry.isFile()) {
                    if (ignoreFiles.includes(entry.name)) {
                        continue;
                    }

                    const hasValidExtension = allowedExtensions.some(ext => entry.name.endsWith(ext));
                    if (hasValidExtension) {
                        
                        // CRITICAL SAFETY VALVE: Enforce max file size before reading into RAM
                        const fileStats = await fs.stat(fullPath);
                        if (fileStats.size > maxFileSizeBytes) {
                            console.warn(`[Packer Warning] Skipping ${entry.name} - Exceeds size limit (${fileStats.size} bytes)`);
                            continue; 
                        }

                        let fileContent = await fs.readFile(fullPath, 'utf8');
                        
                        // Aggressive whitespace normalization for maximum compression / hit rate
                        fileContent = fileContent.replace(/\r\n/g, '\n');
                        
                        // Escape CDATA closers to prevent XML breakage
                        fileContent = fileContent.replace(/]]>/g, ']]]]><![CDATA[>');

                        // Calculate the internal relative path
                        let relativeFilePath = path.relative(basePath, fullPath).replace(/\\/g, '/');
                        if (!relativeFilePath.startsWith('/')) relativeFilePath = '/' + relativeFilePath;

                        // Prepend the repository namespace to prevent file path collisions
                        let namespacedPath = `/${sourcePrefix}${relativeFilePath}`.replace(/\/\//g, '/');

                        fileManifest.push({ path: namespacedPath, content: fileContent });
                    }
                }
            }
        } catch (error) {
            console.error(`[Packer Error] Failed reading path ${currentPath}:`, error);
            throw new Error(`Access Denied or Path Missing: ${currentPath}`);
        }
    }

    /**
     * Generates a structural blueprint of the aggregated repositories.
     * This drastically reduces LLM hallucinations regarding file imports and project architecture.
     */
    static _generateTreeMap(fileManifest) {
        if (fileManifest.length === 0) return "No files packed.";
        
        let tree = "Aggregated Project Structure:\n";
        fileManifest.forEach(fileObj => {
            tree += `├── ${fileObj.path}\n`;
        });
        return tree;
    }

    /**
     * Segments the aggregated codebase into XML payloads optimized for LLM token limits.
     */
    static _packIntoChunks(fileManifest, aiPrompt, maxChars) {
        const outputChunks = [];
        
        // Sanitize the master prompt just in case the user types ]]>
        const safePrompt = (aiPrompt || "").replace(/]]>/g, ']]]]><![CDATA[>');
        const masterSystemPrompt = `<system_instructions>\n<![CDATA[\n${safePrompt}\n]]>\n</system_instructions>\n\n`;
        
        // Calculate dynamic boundary to ensure prompt fits within max limits
        const availableChunkCapacity = maxChars - masterSystemPrompt.length - 150; 
        if (availableChunkCapacity <= 1000) {
            throw new Error("Your Master AI Prompt is too large for the configured maxCharsPerChunk threshold.");
        }
        
        let activeChunkXML = "";
        let activeChunkLength = 0;

        for (const fileObj of fileManifest) {
            const fileWrapperOverhead = `\n<file path="${fileObj.path}">\n<![CDATA[\n\n]]>\n</file>\n`.length;
            const totalFileFootprint = fileWrapperOverhead + fileObj.content.length;

            // Scenario 1: Single file exceeds the chunk capacity (needs fragmentation)
            if (totalFileFootprint > availableChunkCapacity) {
                
                if (activeChunkXML) {
                    outputChunks.push(activeChunkXML);
                    activeChunkXML = "";
                    activeChunkLength = 0;
                }

                let remainingFileContent = fileObj.content;
                let fragmentIndex = 1;

                while (remainingFileContent.length > 0) {
                    const availableSpaceForFragment = availableChunkCapacity - fileWrapperOverhead - 25; 
                    const dataFragment = remainingFileContent.substring(0, availableSpaceForFragment);
                    
                    outputChunks.push(`\n<file path="${fileObj.path}" part="${fragmentIndex}">\n<![CDATA[\n${dataFragment}\n]]>\n</file>\n`);
                    
                    remainingFileContent = remainingFileContent.substring(availableSpaceForFragment);
                    fragmentIndex++;
                }
                continue;
            }

            // Scenario 2: Adding the file would overflow the current chunk
            if (activeChunkLength + totalFileFootprint > availableChunkCapacity) {
                outputChunks.push(activeChunkXML);
                activeChunkXML = "";
                activeChunkLength = 0;
            }

            // Scenario 3: File fits safely into the current chunk
            activeChunkXML += `\n<file path="${fileObj.path}">\n<![CDATA[\n${fileObj.content}\n]]>\n</file>\n`;
            activeChunkLength += totalFileFootprint;
        }

        // Flush any remaining data in the buffer
        if (activeChunkXML) {
            outputChunks.push(activeChunkXML);
        }

        const totalChunks = outputChunks.length;
        
        // Wrap all fragments in the final XML schema
        return outputChunks.map((chunkContent, index) => {
            const isFirstChunk = index === 0;
            const prependedPrompt = isFirstChunk ? masterSystemPrompt : "";
            
            return `${prependedPrompt}<context_chunk current="${index + 1}" total="${totalChunks}">\n${chunkContent}</context_chunk>`;
        });
    }

    /**
     * Enterprise-safe deletion gatekeeper. 
     * Validates directory integrity and containment before obliteration.
     */
    static async _safeCleanup(targetDirectory) {
        try {
            // Guard 1: Prohibit null or root path targeting
            if (!targetDirectory || targetDirectory === os.tmpdir() || targetDirectory === '/' || targetDirectory === 'C:\\') {
                console.error(`[Security Critical] Refusing to delete protected or root path: ${targetDirectory}`);
                return;
            }

            // Guard 2: Enforce OS Temp Vault containment
            if (!targetDirectory.startsWith(os.tmpdir())) {
                console.error(`[Security Critical] Target directory is outside OS temp vault boundaries: ${targetDirectory}`);
                return;
            }

            // Guard 3: Validate application-specific nomenclature
            const targetBaseName = path.basename(targetDirectory);
            if (!targetBaseName.startsWith('sap-builder-')) {
                 console.error(`[Security Critical] Target lacks secure application prefix: ${targetDirectory}`);
                 return;
            }

            // Guard 4: Existential and Directory Type verification
            try {
                const directoryStats = await fs.stat(targetDirectory);
                if (!directoryStats.isDirectory()) {
                    return; 
                }
            } catch (error) {
                return; 
            }

            // Guard 5: Repository verification (Check for .git footprint)
            const gitSubFolderPath = path.join(targetDirectory, '.git');
            try {
                await fs.stat(gitSubFolderPath);
            } catch (error) {
                 console.warn(`[Cleanup Warning] Directory ${targetDirectory} is missing '.git' structure. Executing deletion anyway based on secure prefix match.`);
            }

            // Final Execution: Complete unlinked deletion
            await fs.rm(targetDirectory, { recursive: true, force: true });
            console.log(`[Cleanup] Successfully secured and obliterated temporary allocation.`);

        } catch (cleanupError) {
            console.error(`[Cleanup Error] Could not safely remove temporary directory ${targetDirectory}:`, cleanupError.message);
        }
    }
}

module.exports = ContextPacker;