/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LLM_PROVIDER?: string;
  readonly VITE_LLM_MODEL?: string;
  /** @deprecated Prefer VITE_LLM_MODEL; still used when provider is gemini. */
  readonly VITE_GEMINI_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

import type { ModelViewerElement } from '@google/model-viewer';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<
        React.HTMLAttributes<ModelViewerElement> & {
          src?: string;
          'ios-src'?: string;
          ar?: boolean | string;
          'ar-modes'?: string;
          'camera-controls'?: boolean | string;
          'touch-action'?: string;
          alt?: string;
        },
        ModelViewerElement
      >;
    }
  }
}
