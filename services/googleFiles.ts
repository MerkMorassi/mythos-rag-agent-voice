import { GoogleGenAI } from "@google/genai";
import { CloudFile } from "../types";

export const uploadCloudFile = async (file: File): Promise<CloudFile> => {
  const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");
  
  const ai = new GoogleGenAI({ apiKey });
  
  // Use the Files API to upload
  const uploadResult = await ai.files.upload({
    file: file,
    config: {
      displayName: file.name,
      mimeType: file.type
    }
  });

  // The SDK returns the File object directly
  return uploadResult as unknown as CloudFile;
};

export const listCloudFiles = async (): Promise<CloudFile[]> => {
  const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
  if (!apiKey) return [];
  
  const ai = new GoogleGenAI({ apiKey });
  
  try {
    const response = await ai.files.list();
    const files: CloudFile[] = [];
    
    // The list method returns a Pager which is an async iterable
    for await (const f of response) {
      files.push({
        name: f.name || '',
        displayName: f.displayName || 'Untitled',
        mimeType: f.mimeType || '',
        sizeBytes: f.sizeBytes || '',
        createTime: f.createTime || '',
        state: f.state as any,
        uri: f.uri || ''
      });
    }
    return files;
  } catch (e) {
    console.error("Failed to list cloud files", e);
    return [];
  }
};

export const deleteCloudFile = async (fileName: string): Promise<void> => {
  const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
  if (!apiKey) {
    console.error("[deleteCloudFile] API Key missing. Cannot delete file:", fileName);
    throw new Error("API Key missing.");
  }
  
  console.log(`[deleteCloudFile] Attempting to delete file: "${fileName}"`);
  const ai = new GoogleGenAI({ apiKey });
  
  try {
    await ai.files.delete({ name: fileName });
    console.log(`[deleteCloudFile] Successfully deleted file: "${fileName}"`);
  } catch (e: any) {
    console.error(`[deleteCloudFile] API error deleting "${fileName}":`, e);
    throw new Error(`Cloud API returned an error: ${e.message || 'Unknown error'}.`);
  }
};

export const getFile = async (name: string): Promise<CloudFile> => {
  const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.files.get({ name });
  return response as unknown as CloudFile;
};

export const waitForFileActive = async (file: CloudFile): Promise<CloudFile> => {
  console.log(`[Files] Waiting for ${file.name} to process...`);
  let current = file;
  let attempts = 0;
  // Poll for up to 60 seconds (30 * 2s)
  while (current.state === 'PROCESSING' && attempts < 30) {
    await new Promise(r => setTimeout(r, 2000));
    current = await getFile(file.name);
    attempts++;
  }
  if (current.state !== 'ACTIVE') {
    throw new Error(`File processing failed or timed out. State: ${current.state}`);
  }
  return current;
};