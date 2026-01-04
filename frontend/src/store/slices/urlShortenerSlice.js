import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// Helper to parse worker responses (JSON or text) and surface meaningful errors
async function parseWorkerResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  let body = null;

  if (contentType.includes('application/json')) {
    try {
      body = await response.json();
    } catch (e) {
      console.error('Failed to parse JSON response from worker:', e);
      body = null;
    }
  } else {
    try {
      body = await response.text();
    } catch (e) {
      console.error('Failed to read text response from worker:', e);
      body = null;
    }
  }

  return body;
}

function getErrorMessageFromBody(body, status, defaultMsg) {
  const prefix = typeof status === 'number' ? `[HTTP ${status}] ` : '';
  const baseDefault = prefix + defaultMsg;

  if (body == null) return baseDefault;

  if (typeof body === 'string') {
    const trimmed = body.trim();
    return trimmed ? prefix + trimmed : baseDefault;
  }

  if (typeof body === 'object') {
    if (typeof body.message === 'string' && body.message.trim() !== '') {
      return prefix + body.message;
    }
    if (typeof body.key === 'string' && body.key.trim() !== '') {
      return prefix + body.key;
    }
    try {
      return prefix + JSON.stringify(body);
    } catch (e) {
      console.error('Failed to stringify error body:', e);
      return baseDefault;
    }
  }

  return baseDefault;
}

// Async thunk for shortening URL
export const shortenUrl = createAsyncThunk(
  'urlShortener/shortenUrl',
  async ({ url, customSlug }, { rejectWithValue }) => {
    try {
      const payload = { url };
      if (customSlug && customSlug.trim() !== '') {
        payload.custom_slug = customSlug.trim();
      }

      const response = await fetch(window.location.origin + '/shorten', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const result = await parseWorkerResponse(response);

      if (response.ok && result && typeof result.short_url === 'string') {
        return result.short_url;
      } else {
        const errorMsg = getErrorMessageFromBody(
          result,
          response.status,
          'Unable to shorten URL. Please check your input and try again.'
        );
        return rejectWithValue(errorMsg);
      }
    } catch (error) {
      console.error('Network error:', error);
      return rejectWithValue('Network error. Please try again.');
    }
  }
);

const initialState = {
  longUrl: '',
  customSlug: '',
  shortUrl: null,
  isLoading: false,
  error: null,
  copySuccess: false,
};

const urlShortenerSlice = createSlice({
  name: 'urlShortener',
  initialState,
  reducers: {
    setLongUrl: (state, action) => {
      state.longUrl = action.payload;
      state.error = null; // Clear error when user types
    },
    setCustomSlug: (state, action) => {
      state.customSlug = action.payload;
      state.error = null; // Clear error when user types
    },
    clearError: (state) => {
      state.error = null;
    },
    resetForm: (state) => {
      state.longUrl = '';
      state.customSlug = '';
      state.shortUrl = null;
      state.error = null;
      state.copySuccess = false;
    },
    setCopySuccess: (state, action) => {
      state.copySuccess = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(shortenUrl.pending, (state) => {
        state.isLoading = true;
        state.error = null;
        state.copySuccess = false;
      })
      .addCase(shortenUrl.fulfilled, (state, action) => {
        state.isLoading = false;
        state.shortUrl = action.payload;
        state.error = null;
        state.longUrl = '';
        state.customSlug = '';
      })
      .addCase(shortenUrl.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload;
        state.shortUrl = null;
      });
  },
});

export const { setLongUrl, setCustomSlug, clearError, resetForm, setCopySuccess } =
  urlShortenerSlice.actions;

export default urlShortenerSlice.reducer;

