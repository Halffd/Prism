import React from 'react';

interface ImageGenerationSectionProps {
  generatedImage: string | null;
  imageGenerationPrompt: string;
  setImageGenerationPrompt: (value: string) => void;
  generateImage: () => void;
  isGeneratingImage: boolean;
  imageGenerationApiKey: string;
}

export const ImageGenerationSection: React.FC<ImageGenerationSectionProps> = ({
  generatedImage,
  imageGenerationPrompt,
  setImageGenerationPrompt,
  generateImage,
  isGeneratingImage,
  imageGenerationApiKey
}) => {
  if (generatedImage) {
    return (
      <div className="image-generation-result">
        <h3>Generated Image</h3>
        <img src={generatedImage} alt="Generated" style={{ maxWidth: '100%', borderRadius: '8px' }} />
        <div className="image-actions">
          <button
            onClick={() => setImageGenerationPrompt('')}
            className="action-btn"
          >
            Generate New
          </button>
          <button
            onClick={() => {
              // Create a download link for the image
              const link = document.createElement('a');
              link.href = generatedImage;
              link.download = `generated-image-${Date.now()}.png`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
            className="action-btn"
          >
            Download
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="image-generation-section">
      <div className="image-generation-controls">
        <input
          type="text"
          value={imageGenerationPrompt}
          onChange={(e) => setImageGenerationPrompt(e.target.value)}
          placeholder="Enter image generation prompt..."
          className="image-prompt-input"
          disabled={isGeneratingImage}
        />
        <button
          onClick={generateImage}
          disabled={isGeneratingImage || !imageGenerationPrompt.trim() || !imageGenerationApiKey}
          className="image-generate-btn"
        >
          {isGeneratingImage ? 'Generating...' : 'Generate Image'}
        </button>
      </div>
    </div>
  );
};