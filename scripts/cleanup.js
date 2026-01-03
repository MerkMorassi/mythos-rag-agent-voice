
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

// 1. DEFINITION OF ACTIVE FILES (The Schema)
// Any file found in these folders NOT in this list will be deleted.
const DIRECTORY_SCHEMA = {
    'components': [
        'ChatHistoryManager.tsx',
        'KnowledgeManager.tsx',
        'McpManager.tsx',
        'MultiAgentConsole.tsx',
        'RoomFocusConfig.tsx',
        'SettingsManager.tsx',
        'Visualizer.tsx',
        'VoiceCommandList.tsx'
    ],
    'services': [
        'audioUtils.ts',
        'chatterbox.ts',
        'db.ts',
        'externalRouter.ts',
        'googleFiles.ts',
        'ingestion.ts',
        'mcpClient.ts',
        'modelGate.ts',
        'multiAgent.ts',
        'retrievalGate.ts',
        'roomFocus.ts'
    ],
    'patterns': [
        'NumMarkX.ts'
    ],
    'css': [
        'style.css'
    ]
};

// 2. ROOT FILES TO EXPLICITLY REMOVE
// Common legacy files that might be lingering in the root
const ROOT_LEGACY_FILES = [
    'style.css',   // Moved to css/style.css
    'App.css',     // Replaced by global style
    'index.css',   // Replaced by global style
    'main.tsx',    // We use index.tsx
    'main.js'      // We use index.tsx
];

function cleanDirectory(dirName, allowedFiles) {
    const targetDir = path.join(rootDir, dirName);
    
    if (!fs.existsSync(targetDir)) {
        console.log(`[SKIP] Directory ${dirName} does not exist.`);
        return;
    }

    const files = fs.readdirSync(targetDir);
    
    files.forEach(file => {
        // Skip directories within these folders (unless you want recursive logic, but keep it simple for now)
        if (fs.lstatSync(path.join(targetDir, file)).isDirectory()) return;

        if (!allowedFiles.includes(file)) {
            const filePath = path.join(targetDir, file);
            console.log(`[DELETE] Legacy file found: ${dirName}/${file}`);
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                console.error(`[ERROR] Could not delete ${file}:`, e.message);
            }
        }
    });
}

function cleanRoot() {
    ROOT_LEGACY_FILES.forEach(file => {
        const filePath = path.join(rootDir, file);
        if (fs.existsSync(filePath)) {
            console.log(`[DELETE] Root legacy file: ${file}`);
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                console.error(`[ERROR] Could not delete ${file}:`, e.message);
            }
        }
    });
}

console.log("--- STARTING MYTHOS CLEANUP PROTOCOL ---");

// Execute Schema Check
Object.entries(DIRECTORY_SCHEMA).forEach(([dir, allowed]) => {
    cleanDirectory(dir, allowed);
});

// Execute Root Check
cleanRoot();

console.log("--- CLEANUP COMPLETE ---");
console.log("Run 'git add . && git commit -m \"Remove legacy files\"' to sync with GitHub.");
