
import { SomaPermission } from "../types";

export const AccessControl = {
    
    resolve(chmod: string): SomaPermission[] {
        const perms: SomaPermission[] = [];
        const code = chmod.replace(/[^0-7]/g, ''); // Sanitize input
        
        if (code.length !== 3) return []; // Invalid format

        const lore = parseInt(code[0]);
        const tools = parseInt(code[1]);
        const system = parseInt(code[2]);

        // --- SECTOR 1: LORE (Memory) ---
        if (lore & 4) perms.push('READ_LORE');
        if (lore & 2) perms.push('WRITE_LORE');
        if (lore & 1) perms.push('MODIFY_LORE');

        // --- SECTOR 2: TOOLS (Action) ---
        if (tools & 4) perms.push('EXECUTE_CODE');
        if (tools & 2) perms.push('ROUTE_EXTERNAL');
        if (tools & 1) perms.push('GENERATE_MEDIA');

        // --- SECTOR 3: SYSTEM (Admin) ---
        if (system & 4) perms.push('ADMIN_OVERRIDE');
        if (system & 2) perms.push('BROADCAST_COUNCIL');
        if (system & 1) perms.push('SELF_UPDATE');

        return perms;
    },

    getDescription(chmod: string): string {
        const p = this.resolve(chmod);
        const parts = [];
        if (p.includes('READ_LORE')) parts.push("MEM_READ");
        if (p.includes('WRITE_LORE')) parts.push("MEM_WRITE");
        if (p.includes('MODIFY_LORE')) parts.push("MEM_ROOT");
        if (p.includes('EXECUTE_CODE')) parts.push("EXEC");
        if (p.includes('ADMIN_OVERRIDE')) parts.push("ADMIN");
        if (parts.length === 0) return "RESTRICTED";
        return parts.join(' | ');
    }
};
