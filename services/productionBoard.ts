
import { CanonBlock, ApprovalStatus, ProductionStage } from '../types';
import { saveCanonBlock, getCanonBlocks, deleteCanonBlock } from './db';
import { NumMarkX_GenerateID } from '../patterns/NumMarkX';

/**
 * PRODUCTION BOARD SERVICE
 * Manages the "State" of the Animation Pipeline.
 * 
 * Flow:
 * 1. PRODUCER creates a Draft (Stage: IDEATION).
 * 2. User Reviews -> Approves -> Block becomes CANON.
 * 3. PRODUCER creates new Draft (Stage: SCRIPT) referencing Lineage of Ideation Block.
 */

export const ProductionBoardService = {
    
    async getAllBlocks(): Promise<CanonBlock[]> {
        return await getCanonBlocks();
    },

    async getBlocksByStage(stage: ProductionStage): Promise<CanonBlock[]> {
        const all = await this.getAllBlocks();
        return all.filter(b => b.stage === stage);
    },

    /**
     * Creates a new Draft Block. 
     * This is what agents do when they generate content.
     */
    async createDraft(
        stage: ProductionStage,
        title: string,
        content: string,
        agentId: string,
        parentId?: string,
        mediaRef?: string
    ): Promise<CanonBlock> {
        const block: CanonBlock = {
            id: NumMarkX_GenerateID('BLK'),
            stage,
            title,
            content,
            agentId,
            timestamp: Date.now(),
            status: ApprovalStatus.DRAFT,
            version: 1,
            parentId,
            mediaRef
        };
        await saveCanonBlock(block);
        return block;
    },

    /**
     * Promotes a block to Canon status.
     * Effectively "Locking" it as the source of truth for the next stage.
     */
    async approveBlock(id: string): Promise<void> {
        const all = await this.getAllBlocks();
        const block = all.find(b => b.id === id);
        if (block) {
            block.status = ApprovalStatus.APPROVED;
            await saveCanonBlock(block);
        }
    },

    async rejectBlock(id: string, feedback: string): Promise<void> {
        const all = await this.getAllBlocks();
        const block = all.find(b => b.id === id);
        if (block) {
            block.status = ApprovalStatus.REJECTED;
            block.feedback = feedback;
            await saveCanonBlock(block);
        }
    },

    /**
     * Returns the context string for a specific stage based on Approved Canon blocks.
     * Used by agents to know what has been decided so far.
     */
    async getStageContext(currentStage: ProductionStage): Promise<string> {
        const all = await this.getAllBlocks();
        const canon = all.filter(b => b.status === ApprovalStatus.APPROVED);
        
        let context = "=== APPROVED PROJECT CANON ===\n";

        // Logic: If I am Scripting, I need Ideation. If I am Design, I need Ideation + Script.
        const requirements: Partial<Record<ProductionStage, ProductionStage[]>> = {
            [ProductionStage.SCRIPT]: [ProductionStage.IDEATION],
            [ProductionStage.DESIGN]: [ProductionStage.IDEATION, ProductionStage.SCRIPT],
            [ProductionStage.ART]: [ProductionStage.IDEATION, ProductionStage.SCRIPT, ProductionStage.DESIGN]
        };

        const neededStages = requirements[currentStage] || [];
        
        if (neededStages.length === 0 && currentStage === ProductionStage.IDEATION) {
             return context + "No prior canon established. You are the starting point.\n";
        }

        const relevantBlocks = canon.filter(b => neededStages.includes(b.stage));
        
        if (relevantBlocks.length === 0) {
            return context + "(No approved blocks found for previous stages. Wait for approval.)\n";
        }

        relevantBlocks.forEach(b => {
            context += `\n[${b.stage}] ${b.title} (ID: ${b.id})\n${b.content.substring(0, 500)}...\n`;
        });

        return context;
    }
};
