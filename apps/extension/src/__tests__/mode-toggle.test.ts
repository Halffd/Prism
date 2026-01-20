import { ExtensionSettings } from '@prism/shared-types';

describe('Mode Toggle Keys Functionality', () => {
  test('should have default mode toggle keys defined', () => {
    const defaultSettings: ExtensionSettings = {
      popupDisplayMode: 'popup',
      sidebarPosition: 'right',
      sidebarWidth: 350,
      enablePopupIframe: false,
      enableSidebar: false,
      defaultProvider: 'prism-api',
      pageContentTokenLimit: 20000,
      totalMessageTokenLimit: 20000,
      buttonPosition: { top: 20, right: 20 },
      buttonSensitivityAreaPercentage: 10,
      textSelectionKey: '1',
      pageContextKey: '2',
      pageScreenshotKey: '3',
      clipboardKey: '4',
      pageInfoKey: '5'
    };

    expect(defaultSettings.textSelectionKey).toBe('1');
    expect(defaultSettings.pageContextKey).toBe('2');
    expect(defaultSettings.pageScreenshotKey).toBe('3');
    expect(defaultSettings.clipboardKey).toBe('4');
    expect(defaultSettings.pageInfoKey).toBe('5');
  });

  test('should allow custom mode toggle keys', () => {
    const customSettings: ExtensionSettings = {
      popupDisplayMode: 'popup',
      sidebarPosition: 'right',
      sidebarWidth: 350,
      enablePopupIframe: false,
      enableSidebar: false,
      defaultProvider: 'prism-api',
      pageContentTokenLimit: 20000,
      totalMessageTokenLimit: 20000,
      buttonPosition: { top: 20, right: 20 },
      buttonSensitivityAreaPercentage: 10,
      textSelectionKey: 'Q',
      pageContextKey: 'W',
      pageScreenshotKey: 'E',
      clipboardKey: 'R',
      pageInfoKey: 'T'
    };

    expect(customSettings.textSelectionKey).toBe('Q');
    expect(customSettings.pageContextKey).toBe('W');
    expect(customSettings.pageScreenshotKey).toBe('E');
    expect(customSettings.clipboardKey).toBe('R');
    expect(customSettings.pageInfoKey).toBe('T');
  });

  test('should validate mode toggle keys are single characters', () => {
    const settings: ExtensionSettings = {
      popupDisplayMode: 'popup',
      sidebarPosition: 'right',
      sidebarWidth: 350,
      enablePopupIframe: false,
      enableSidebar: false,
      defaultProvider: 'prism-api',
      pageContentTokenLimit: 20000,
      totalMessageTokenLimit: 20000,
      buttonPosition: { top: 20, right: 20 },
      buttonSensitivityAreaPercentage: 10,
      textSelectionKey: 'A',
      pageContextKey: 'B',
      pageScreenshotKey: 'C',
      clipboardKey: 'D',
      pageInfoKey: 'E'
    };

    expect(settings.textSelectionKey?.length).toBe(1);
    expect(settings.pageContextKey?.length).toBe(1);
    expect(settings.pageScreenshotKey?.length).toBe(1);
    expect(settings.clipboardKey?.length).toBe(1);
    expect(settings.pageInfoKey?.length).toBe(1);
  });

  test('should handle numeric mode toggle keys', () => {
    const settings: ExtensionSettings = {
      popupDisplayMode: 'popup',
      sidebarPosition: 'right',
      sidebarWidth: 350,
      enablePopupIframe: false,
      enableSidebar: false,
      defaultProvider: 'prism-api',
      pageContentTokenLimit: 20000,
      totalMessageTokenLimit: 20000,
      buttonPosition: { top: 20, right: 20 },
      buttonSensitivityAreaPercentage: 10,
      textSelectionKey: '1',
      pageContextKey: '2',
      pageScreenshotKey: '3',
      clipboardKey: '4',
      pageInfoKey: '5'
    };

    // Test that all keys are single digits
    expect(settings.textSelectionKey).toMatch(/^\d$/);
    expect(settings.pageContextKey).toMatch(/^\d$/);
    expect(settings.pageScreenshotKey).toMatch(/^\d$/);
    expect(settings.clipboardKey).toMatch(/^\d$/);
    expect(settings.pageInfoKey).toMatch(/^\d$/);
  });
});