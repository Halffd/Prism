import React from 'react';
import {
  IMAGE_MODEL_OPTIONS,
  imageModelOptionLabel,
  imageModelsForAccess,
  type ImageModelAccess,
} from '@prism/image-gen';

interface ImageGenerationSectionProps {
  generatedImages: string[];
  setGeneratedImages: (value: string[]) => void;
  imageGenerationPrompt: string;
  setImageGenerationPrompt: (value: string) => void;
  imageGenerationModel: string;
  setImageGenerationModel: (value: string) => void;
  imageCount: number;
  setImageCount: (value: number) => void;
  generateImage: () => void;
  isGeneratingImage: boolean;
  imageGenerationApiKey: string;
}

const ACCESS_LABEL: Record<ImageModelAccess, string> = {
  free: 'Free models',
  'pro-only': 'Pro-only models',
};

/** How many images one request can ask for. */
export const MAX_IMAGE_GENERATION_COUNT = 4;

const IMAGE_COUNTS = [1, 2, 3, MAX_IMAGE_GENERATION_COUNT];

export const ImageGenerationSection: React.FC<ImageGenerationSectionProps> = ({
  generatedImages,
  setGeneratedImages,
  imageGenerationPrompt,
  setImageGenerationPrompt,
  imageGenerationModel,
  setImageGenerationModel,
  imageCount,
  setImageCount,
  generateImage,
  isGeneratingImage,
  imageGenerationApiKey,
}) => {
  const selectedModel =
    IMAGE_MODEL_OPTIONS.find((model) => model.id === imageGenerationModel) ??
    IMAGE_MODEL_OPTIONS[0];

  if (generatedImages.length > 0) {
    return (
      <div className="image-generation-result">
        <h3>Generated Image{generatedImages.length === 1 ? '' : 's'}</h3>
        <p className="image-result-model">
          {imageModelOptionLabel(selectedModel)} ·{' '}
          {selectedModel.access === 'pro-only'
            ? 'needs image-provider access'
            : 'works with a standard provider token'}
        </p>
        <div className="image-generation-grid">
          {generatedImages.map((image, index) => (
            <figure key={`${index}-${image.slice(-24)}`}>
              <img src={image} alt={`Generated ${index + 1}`} />
              <button
                type="button"
                className="action-btn"
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = image;
                  link.download = `generated-image-${Date.now()}-${index + 1}.png`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
              >
                Download {index + 1}
              </button>
            </figure>
          ))}
        </div>
        <div className="image-actions">
          <button
            type="button"
            onClick={() => {
              setImageGenerationPrompt('');
              setGeneratedImages([]);
            }}
            className="action-btn"
          >
            Generate New
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
          disabled={
            isGeneratingImage ||
            !imageGenerationPrompt.trim() ||
            !imageGenerationApiKey
          }
          className="image-generate-btn"
        >
          {isGeneratingImage ? `Generating ${imageCount}…` : 'Generate Image'}
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
                  {imageModelOptionLabel(model)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="image-count-row">
        <span>Images</span>
        <select
          value={String(imageCount)}
          onChange={(e) =>
            setImageCount(
              Math.min(
                MAX_IMAGE_GENERATION_COUNT,
                Math.max(1, Number(e.target.value) || 1),
              ),
            )
          }
          className="image-count-select"
          aria-label="Select how many images to generate"
          disabled={isGeneratingImage}
        >
          {IMAGE_COUNTS.map((count) => (
            <option key={count} value={String(count)}>
              {count}
            </option>
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
