import { createContext } from 'react';

/** An object URL for an unuploaded photograph. */
export const LocalPhotos = createContext<(path: string) => string | undefined>(() => undefined);
