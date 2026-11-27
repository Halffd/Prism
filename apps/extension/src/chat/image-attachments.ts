import type { ApiResponse, OCRResult } from '@prism/shared-types';

/**
 * Image attachment helpers for the chat surfaces.
 *
 * The composer keeps attached images as data URLs: a data URL persists
 * with the transcript, survives a reload, and can be handed to either the
 * chat request (as an image attachment) or the OCR capability (as a
 * transcribe request) without another upload step.
 */

/** The smallest client surface the transcribe helper needs. */
export interface ImageTranscribeClient {
  ocr: (request: {
    image: Blob | string;
    language?: string;
    mimeType?: string;
  }) => Promise<ApiResponse<OCRResult>>;
}

/** True when the file is an image the chat can send. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/** Reads image files as data URLs, skipping anything else. */
export async function readImageFilesAsDataUrls(
  files: readonly File[],
): Promise<string[]> {
  const imageFiles = files.filter(isImageFile);
  return Promise.all(
    imageFiles.map(
      (file) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (event) => {
            resolve(
              typeof event.target?.result === 'string'
                ? (event.target.result as string)
                : '',
            );
          };
          reader.onerror = () => resolve('');
          reader.readAsDataURL(file);
        }),
    ),
  ).then((urls) => urls.filter((url) => url.length > 0));
}

/** Converts a data URL to a Blob. Unknown prefixes return null. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    return null;
  }
  const mimeType = match[1] || 'application/octet-stream';
  const payload = match[3];
  try {
    if (match[2]) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new Blob([bytes], { type: mimeType });
    }
    return new Blob([decodeURIComponent(payload)], { type: mimeType });
  } catch {
    return null;
  }
}

/**
 * Transcribes image attachments to text through the OCR capability.
 *
 * The texts are returned in the order of their images. A provider failure
 * for one image does not drop the others: its result is an empty string,
 * so the caller can still collect what succeeded.
 */
export async function transcribeImageAttachments(
  client: ImageTranscribeClient | null,
  images: readonly string[],
): Promise<string[]> {
  if (!client) {
    return [];
  }

  const texts = await Promise.all(
    images.map(async (image) => {
      if (!image.startsWith('data:image/')) {
        return '';
      }
      const blob = dataUrlToBlob(image);
      if (!blob) {
        return '';
      }
      try {
        const response = await client.ocr({
          image: blob,
          mimeType: blob.type,
        });
        if (response.success && response.data?.text) {
          return response.data.text;
        }
      } catch {
        // One failed image must not fail the batch.
      }
      return '';
    }),
  );

  return texts;
}

/** Appends image transcripts to the composer text as labelled blocks. */
export function appendTranscripts(
  text: string,
  transcripts: readonly string[],
): string {
  const usable = transcripts
    .map((transcript) => transcript.trim())
    .filter((transcript) => transcript.length > 0);
  if (usable.length === 0) {
    return text;
  }
  const block = usable
    .map((transcript) => `--- Image transcript ---\n${transcript}`)
    .join('\n\n');
  if (!text.trim()) {
    return block;
  }
  return `${text}\n\n${block}`;
}
