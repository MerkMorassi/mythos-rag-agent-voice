
declare global {
    interface Window {
        loadPyodide: any;
    }
}

let pyodideReadyPromise: Promise<any> | null = null;

export const PythonSandbox = {
    /**
     * Initializes the Pyodide runtime. Loads the script from CDN if not present.
     * Uses a singleton promise to ensure only one instance is created.
     */
    async init() {
        if (pyodideReadyPromise) return pyodideReadyPromise;

        pyodideReadyPromise = (async () => {
            if (!window.loadPyodide) {
                console.log("[PythonSandbox] Loading Pyodide script...");
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js';
                document.head.appendChild(script);
                await new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = reject;
                });
            }
            console.log("[PythonSandbox] Initializing WASM...");
            const py = await window.loadPyodide({
                indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/"
            });
            console.log("[PythonSandbox] Ready.");
            return py;
        })();

        return pyodideReadyPromise;
    },

    /**
     * Executes Python code and returns the combined stdout and return value.
     * @param code Python source code
     */
    async execute(code: string): Promise<string> {
        try {
            const py = await this.init();
            
            // Capture standard output
            let stdout = "";
            py.setStdout({ batched: (msg: string) => { stdout += msg + "\n"; } });
            
            // Auto-load packages if imports are detected (basic heuristic)
            await py.loadPackagesFromImports(code);
            
            // Run the code
            const result = await py.runPythonAsync(code);
            
            let output = stdout;
            if (result !== undefined) {
                // If it's a complex object, try to convert to JS or string
                try {
                    output += `\n[RETURN]: ${result.toString()}`;
                } catch(e) {
                    output += `\n[RETURN]: (Non-stringifiable result)`;
                }
            }
            
            return output.trim() || "[No Output]";
        } catch (e: any) {
            console.error("Python Execution Error", e);
            return `Traceback (most recent call last):\n${e.message}`;
        }
    }
};
