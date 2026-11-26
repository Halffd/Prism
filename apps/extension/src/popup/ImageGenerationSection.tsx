import React from 'react';
import {
  IMAGE_MODEL_OPTIONS,
  imageModelsForAccess,
  type ImageModelAccess,
} from '@prism/image-gen';

interface ImageGenerationSectionProps {
  generatedImage: string | null;
  imageGenerationPrompt: string;
  setImageGenerationPrompt: (value: string) => void;
  imageGenerationModel: string;
  setImageGenerationModel: (value: string) => void;
  generateImage: () => void;
  isGeneratingImage: boolean;
  imageGenerationApiKey: string;
}

const ACCESS_LABEL: Record<ImageModelAccess, string> = {
  free: 'Free models',
  'pro-only': 'Pro-only models',
};

export const ImageGenerationSection: React.FC<ImageGenerationSectionProps> = ({
  generatedImage,
  imageGenerationPrompt,
  setImageGenerationPrompt,
  imageGenerationModel,
  setImageGenerationModel,
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

  const selectedModel =
    IMAGE_MODEL_OPTIONS.find((model) => model.id === imageGenerationModel) ??
    IMAGE_MODEL_OPTIONS[0];

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
      <label className="image-model-row">
        <span>Model</span>
        <select
          value={selectedModel.id}
          onChange={(e) => setImageGenerationModel(e.target.value)}
          className="image-model-select"
          aria-label="Select image model"
          disabled={isGeneratingImage}
        >
          {(['free', 'pro-only'] as const).map((access) => (
            <optgroup key={access} label={ACCESS_LABEL[access]}>
              {imageModelsForAccess(access).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="image-model-note">
        {selectedModel.access === 'pro-only'
          ? 'Pro-only: this model needs access from the image provider.'
          : 'Free: this model works with a standard provider token.'}
      </p>
    </div>
  );
};