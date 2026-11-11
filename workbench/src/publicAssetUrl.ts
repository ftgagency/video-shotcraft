/** Resolve a file from public/ beneath Vite's configured deployment base. */
export const publicAssetUrl = (file: string) =>
  `${import.meta.env.BASE_URL}${file.replace(/^\/+/, "")}`;
