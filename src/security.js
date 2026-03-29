const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const ALGORITHM = 'aes-256-gcm';
// Isolate the vault in the current user's home directory
const CONFIG_DIR = path.join(os.homedir(), '.sap-context-builder');
const AUTH_FILE = path.join(CONFIG_DIR, 'vault.enc');

/**
 * Enterprise Security Vault
 * Pure JS AES-256-GCM implementation. Replaces deprecated keytar 
 * with a hardware-tied, zero-dependency cryptographic vault.
 */
class SecurityManager {
    
    /**
     * Generates a stable, machine-specific cryptographic key.
     * Binds the encryption to the current OS User and Hardware Hostname.
     */
    static _getMachineKey() {
        // Create a unique salt using the physical machine's identity
        const machineIdentity = `${os.userInfo().username}-${os.hostname()}-sap-builder-secure-salt`;
        // Scrypt provides strong protection against brute-force attacks
        return crypto.scryptSync(machineIdentity, 'enterprise-offline-salt', 32);
    }

    /**
     * Ensures the secure configuration directory exists.
     */
    static async _ensureDirectory() {
        try {
            await fs.mkdir(CONFIG_DIR, { recursive: true });
        } catch (error) {
            // Ignore if directory already exists
        }
    }

    /**
     * Encrypts and securely stores the GitHub Personal Access Token.
     */
    static async saveGitHubToken(token) {
        if (!token) throw new Error("Token cannot be empty.");
        
        await this._ensureDirectory();

        // Generate a random Initialization Vector for semantic security
        const initializationVector = crypto.randomBytes(12);
        const machineKey = this._getMachineKey();
        
        const cipher = crypto.createCipheriv(ALGORITHM, machineKey, initializationVector);

        let encryptedToken = cipher.update(token, 'utf8', 'hex');
        encryptedToken += cipher.final('hex');
        
        // GCM Authentication Tag ensures the ciphertext hasn't been tampered with
        const authenticationTag = cipher.getAuthTag().toString('hex');

        const payload = JSON.stringify({ 
            iv: initializationVector.toString('hex'), 
            authTag: authenticationTag, 
            encrypted: encryptedToken 
        });

        // Write file with strict 0o600 permissions (Read/Write for owner ONLY)
        await fs.writeFile(AUTH_FILE, payload, { mode: 0o600 });
    }

    /**
     * Retrieves and decrypts the GitHub Personal Access Token.
     * Returns null if no token exists or decryption fails.
     */
    static async getGitHubToken() {
        try {
            const fileData = await fs.readFile(AUTH_FILE, 'utf8');
            const { iv, authTag, encrypted } = JSON.parse(fileData);

            const machineKey = this._getMachineKey();
            const decipher = crypto.createDecipheriv(ALGORITHM, machineKey, Buffer.from(iv, 'hex'));
            
            // Validate the payload hasn't been tampered with
            decipher.setAuthTag(Buffer.from(authTag, 'hex'));

            let decryptedToken = decipher.update(encrypted, 'hex', 'utf8');
            decryptedToken += decipher.final('utf8');
            
            return decryptedToken;

        } catch (error) {
            // Fails cleanly if the file is missing, corrupted, or moved to a different machine
            return null; 
        }
    }

    /**
     * Obliterates the vault file from the disk.
     */
    static async deleteGitHubToken() {
        try {
            await fs.unlink(AUTH_FILE);
        } catch (error) {
            // Ignore if the file does not exist
        }
    }
}

module.exports = SecurityManager;