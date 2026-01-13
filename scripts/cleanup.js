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
        'GraphVisualizer.tsx',
        'Holodeck.tsx',
        'KnowledgeManager.tsx',
        'LorepackHarness.tsx',
        'McpManager.tsx',
        'MediaPlayer.tsx',
        'MediaGallery.tsx',
        'MultiAgentConsole.tsx',
        'ProductionBoard.tsx',
        'PromptManager.tsx',
        'RoomFocusConfig.tsx',
        'SettingsManager.tsx',
        'Terminal.tsx',
        'ToolManager.tsx',
        'Visualizer.tsx',
        'VoiceCommandList.tsx'
    ],
    'css': [
        'style.css',
        'lorepack-harness.css'
    ],
    'hooks': [
        'useGeminiLive.ts'
    ],
    'patterns': [
        'NumMarkX.ts'
    ],
    'services': [
        'accessControl.ts',
        'audioUtils.ts',
        'chatterbox.ts',
        'db.ts',
        'externalRouter.ts',
        'googleFiles.ts',
        'ingestion.ts',
        'llmUsageLogger.ts',
        'lorepack.ts',
        'mcpClient.ts',
        'modelGate.ts',
        'multiAgent.ts',
        'productionBoard.ts',
        'pythonSandbox.ts',
        'retrievalGate.ts',
        'roomFocus.ts',
        'shell.ts',
        'soma.ts',
        'virtualFs.ts',
        'voiceCommandService.ts'
    ],
    'services/llmProviders': [
        'dolphinProvider.ts',
        'geminiProvider.ts',
        'ILLMProvider.ts',
        'openLMProvider.ts',
        'openRouterProvider.ts'
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
        const filePath = path.join(targetDir, file);
        // Skip directories within these folders for this simple script
        if (fs.lstatSync(filePath).isDirectory()) {
            if (!Object.keys(DIRECTORY_SCHEMA).includes(`${dirName}/${file}`)) {
                 console.log(`[INFO] Skipping un-schemed directory: ${dirName}/${file}`);
            }
            return;
        }

        if (!allowedFiles.includes(file)) {
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
    cleanDirectory(dir, allowed.sort());
});

// Execute Root Check
cleanRoot();

console.log("--- CLEANUP COMPLETE ---");
console.log("Run 'git add . && git commit -m \"Housekeeping: Sync cleanup script\"' to sync changes.");