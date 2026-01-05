
import { SomaPermission, SomaActionType } from "../types";

export const AccessControl = {
    
    /**
     * Resolves an octal string (e.g., "755") into specific capability flags.
     */
    resolve(chmod: string): SomaPermission[] {
        const perms: SomaPermission[] = [];
        const code = chmod.replace(/[^0-7]/g, ''); // Sanitize input
        
        // Default to restricted 400 if invalid
        if (code.length !== 3) return ['READ_LORE']; 

        const lore = parseInt(code[0]);
        const tools = parseInt(code[1]);
        const system = parseInt(code[2]);

        // --- SECTOR 1: LORE (Memory) ---
        // 4 = Read, 2 = Write, 1 = Modify/Root
        if (lore & 4) perms.push('READ_LORE');
        if (lore & 2) perms.push('WRITE_LORE');
        if (lore & 1) perms.push('MODIFY_LORE');

        // --- SECTOR 2: TOOLS (Action) ---
        // 4 = Execute Code, 2 = Route External, 1 = Generate Media
        if (tools & 4) perms.push('EXECUTE_CODE');
        if (tools & 2) perms.push('ROUTE_EXTERNAL');
        if (tools & 1) perms.push('GENERATE_MEDIA');

        // --- SECTOR 3: SYSTEM (Governance) ---
        // 4 = Admin (chmod), 2 = Broadcast (Interrupt), 1 = Self Update
        if (system & 4) perms.push('ADMIN_OVERRIDE');
        if (system & 2) perms.push('BROADCAST_COUNCIL');
        if (system & 1) perms.push('SELF_UPDATE');

        return perms;
    },

    /**
     * The Gatekeeper. Checks if an agent (via their chmod string) can perform an action.
     */
    canPerform(chmod: string, action: SomaActionType): boolean {
        const perms = this.resolve(chmod);

        switch (action) {
            // MNEMOSYNE SECTOR
            case SomaActionType.QUERY_DB:
                return perms.includes('READ_LORE');
            case SomaActionType.INGEST_DATA:
                return perms.includes('WRITE_LORE');
            case SomaActionType.DELETE_DATA:
                return perms.includes('MODIFY_LORE');
            
            // TECHNE SECTOR
            case SomaActionType.EXEC_CODE:
                return perms.includes('EXECUTE_CODE');
            case SomaActionType.ROUTE_REQUEST:
                return perms.includes('ROUTE_EXTERNAL');
            case SomaActionType.CREATE_IMAGE:
                return perms.includes('GENERATE_MEDIA');

            // METRON SECTOR
            case SomaActionType.SYSTEM_ADMIN:
                return perms.includes('ADMIN_OVERRIDE');
            case SomaActionType.BROADCAST:
                return perms.includes('BROADCAST_COUNCIL');
            
            // SYNAPSE PROTOCOL
            // Collaboration requires the ability to Route (Bit 2 in Tools or System Broadcast)
            case SomaActionType.COLLABORATE:
            case SomaActionType.DELEGATE_TASK:
                return perms.includes('ROUTE_EXTERNAL') || perms.includes('BROADCAST_COUNCIL');

            default:
                return false;
        }
    },

    getDescription(chmod: string): string {
        const p = this.resolve(chmod);
        const parts = [];
        
        // Condensed display string for UI
        if (p.includes('MODIFY_LORE')) parts.push("ROOT_MEM");
        else if (p.includes('WRITE_LORE')) parts.push("RW_MEM");
        else if (p.includes('READ_LORE')) parts.push("R_MEM");
        
        if (p.includes('EXECUTE_CODE')) parts.push("EXEC");
        if (p.includes('ROUTE_EXTERNAL')) parts.push("ROUTE");
        if (p.includes('GENERATE_MEDIA')) parts.push("GEN");
        
        if (p.includes('ADMIN_OVERRIDE')) parts.push("ADMIN");
        
        if (parts.length === 0) return "RESTRICTED";
        return parts.join(' | ');
    }
};
