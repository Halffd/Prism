import {
  appendTranscripts,
  dataUrlToBlob,
  transcribeImageAttachments,
} from '../chat/image-attachments';

describe('image attachment helpers', () => {
  it('decodes a base64 data URL to a blob', () => {
    const blob = dataUrlToBlob('data:image/png;base64,AA==');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('image/png');
  });

  it('has no blob for a non-data URL', () => {
    expect(dataUrlToBlob('https://example.test/a.png')).toBeNull();
  });

  it('transcribes every image through the OCR capability', async () => {
    const client = {
      ocr: jest.fn(async ({ image }: { image: Blob }) => {
        if (image.type === 'image/png') {
          return { success: true, data: { text: 'first', confidence: 1 } };
        }
        return { success: false, error: 'no ocr' };
      }),
    };

    const transcripts = await transcribeImageAttachments(client, [
      'data:image/png;base64,AA==',
      'data:image/jpeg;base64,AA==',
      'https://example.test/a.png',
    ]);

    expect(client.ocr).toHaveBeenCalledTimes(2);
    expect(transcripts).toEqual(['first', '', '']);
  });

  it('appends only usable transcripts', () => {
    expect(appendTranscripts('look', ['  hello  ', '', '   '])).toBe(
      'look\n\n--- Image transcript ---\nhello',
    );
    expect(appendTranscripts('', ['hi'])).toBe('--- Image transcript ---\nhi');
    expect(appendTranscripts('unchanged', ['', '  '])).toBe('unchanged');
  });
});
