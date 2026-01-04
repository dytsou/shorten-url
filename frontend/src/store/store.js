import { configureStore } from '@reduxjs/toolkit';
import urlShortenerReducer from './slices/urlShortenerSlice';

export const store = configureStore({
  reducer: {
    urlShortener: urlShortenerReducer,
  },
});

