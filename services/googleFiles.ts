
import { GoogleGenAI } from "@google/genai";
import { CloudFile } from "../types";

export const uploadCloudFile = async (file: File): Promise<CloudFile> => {
  if (!process.env.API_KEY) throw new Error("API Key missing");
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Use the Files API to upload
  const uploadResult = await ai.files.upload({
    file: file,
    config: {
      displayName: file.name,
      mimeType: file.type
    }
  });

  return uploadResult.file as unknown as CloudFile;
};

export const listCloudFiles = async (): Promise<CloudFile[]> => {
  if (!process.env.API_KEY) return [];
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const response = await ai.files.list();
    // Map response to our CloudFile type
    return (response.files || []).map((f: any) => ({
      name: f.name,
      displayName: f.displayName || 'Untitled',
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      createTime: f.createTime,
      state: f.state,
      uri: f.uri
    }));
  } catch (e) {
    console.error("Failed to list cloud files", e);
    return [];
  }
};

export const deleteCloudFile = async (fileName: string): Promise<void> => {
  if (!process.env.API_KEY) return;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  await ai.files.delete({ name: fileName });
};
