import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setCustomSlug } from '../store/slices/urlShortenerSlice';

function CustomSlugInput() {
  const dispatch = useDispatch();
  const customSlug = useSelector((state) => state.urlShortener.customSlug);
  const [domain, setDomain] = useState('');

  useEffect(() => {
    setDomain(window.location.host);
  }, []);

  const handleChange = (e) => {
    const value = e.target.value;
    const validPattern = /^[a-zA-Z0-9\-_]*$/;

    if (validPattern.test(value)) {
      dispatch(setCustomSlug(value));
      e.target.setCustomValidity('');
    } else {
      e.target.setCustomValidity('Only letters, numbers, hyphens, and underscores are allowed');
    }
  };

  return (
    <div className="form-group">
      <label htmlFor="customSlug">Custom short URL (optional):</label>
      <div className="custom-slug-group">
        <span className="url-prefix">{domain}/</span>
        <input
          type="text"
          id="customSlug"
          name="customSlug"
          className="custom-slug-input"
          placeholder="my-custom-link"
          pattern="[a-zA-Z0-9\-_]+"
          maxLength="50"
          value={customSlug}
          onChange={handleChange}
        />
      </div>
      <div className="help-text">
        Leave empty for auto-generated short URL. Only letters, numbers, hyphens, and underscores
        allowed.
      </div>
    </div>
  );
}

export default CustomSlugInput;

