<script type="module">
    // Load Core Modules for Management Functionality
    import { SimpleDB } from '../core/mythos-db.js';
    import { createNewLIA, renderAgentList, purgeMythosVault } from './js/admin/agent-manager.js';

    // --- SETUP ---
    const DB = new SimpleDB(); 
    const $=(id)=>document.getElementById(id); 

    // --- LOGGER (Internal to Management Console) ---
    const log = (msg, type = 'info') => { 
        const box = $('systemLog');
        if (!box) return;

        const el = document.createElement('div');
        const color = type === 'error' ? 'var(--error)' : type === 'ok' ? 'var(--success)' : 'var(--dim-text)';
        el.style.color = color;
        el.style.marginBottom = '4px';
        el.innerHTML = `<span style="opacity:0.5;">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
        
        // Use prepend to show latest logs at the top
        if (box.firstChild) {
            box.prepend(el);
        } else {
            box.appendChild(el);
        }
        
        // Simple log clearing logic
        while (box.children.length > 50) {
            box.removeChild(box.lastChild);
        }
    };

    // --- MANAGEMENT UI HANDLERS (Exposed to HTML) ---
    window.manageUI = {
        
        async refreshList() {
            try { 
                const agents = await DB.getAll('agents'); 
                
                // Use the shared render function (which expects the DOM element #agentList)
                // We mock the required structure for the shared renderAgentList function
                const listContainer = $('agentList');
                if (listContainer) listContainer.id = 'agent-list'; // Temporary rename to match renderAgentList's expected ID
                
                // Note: renderAgentList expects the list container to be #agent-list, 
                // but the UI template uses #agentList. We use the shared function.
                renderAgentList(agents); 

                if (listContainer) listContainer.id = 'agentList'; // Restore original ID
                
                $('countDisplay').textContent = `${agents.length} AGENTS`;
                log(`Manifest Refreshed. Total Agents: ${agents.length}`, 'ok'); 
            } catch (err) { 
                log(`READ ERROR: ${err.message}`, 'error'); 
            }
        },

        async handleCreateAgent() {
            const btn = $('initBtn');
            const handle = $('newHandle').value.trim(); 
            const role = $('newRole').value.trim(); 
            
            if (!handle) { log("ERROR: Handle required.", 'error'); return; }

            btn.disabled = true;
            btn.textContent = "WRITING TO DB...";

            try {
                log(`Attempting to forge new LIA: ${handle}...`);
                // Calls the core management function using input data
                await createNewLIA(handle, role); 
                
                log(`SUCCESS: ${handle} Initialized.`, 'ok'); 
                $('newHandle').value = ''; 
                $('newRole').value = 'Liminal Intelligence Agent';
                
                await window.manageUI.refreshList(); 
                
            } catch (err) { 
                log(`CRITICAL FAILURE: ${err.message}`, 'error'); 
            } finally {
                btn.disabled = false;
                btn.textContent = "INITIALIZE LIA";
            }
        },

        async handlePurge() {
            try {
                // purgeMythosVault handles its own confirmation dialog
                log("Initiating Purge Protocol...", 'error');
                await purgeMythosVault();
                
                // If successful, the DB is fully deleted and we need to refresh the page
                log("DATABASE PURGED. System reset. Reloading...", 'error');
                setTimeout(() => location.reload(), 500); 
            } catch(err) {
                if (!err.message.includes("aborted")) {
                    log(`PURGE ERROR: ${err.message}`, 'error');
                }
            }
        },
        
        // Handle refresh list from the button click
        handleRefresh: async function() {
            await window.manageUI.refreshList();
        }
    };

    // --- INIT ---
    window.addEventListener('DOMContentLoaded', async () => {
        try {
            await DB.ready;
            $('status').textContent = "DB ONLINE";
            $('status').style.color = "var(--success)";
            log("System Initialized. Database Connected.", 'ok');
            await window.manageUI.refreshList();
        } catch (e) {
            $('status').textContent = "DB ERROR";
            $('status').style.color = "var(--error)";
            log(`INIT ERROR: ${e}`, 'error');
        }
    });
</script>