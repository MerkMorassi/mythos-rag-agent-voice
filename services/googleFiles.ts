
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
        name: f.name,
        displayName: f.displayName || 'Untitled',
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        createTime: f.createTime,
        state: f.state as any,
        uri: f.uri
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
  if (!apiKey) return;
  const ai = new GoogleGenAI({ apiKey });
  await ai.files.delete({ name: fileName });
};
