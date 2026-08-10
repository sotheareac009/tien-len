'use client';

// Google profile photo when signed in, initial letter otherwise.
export default function Avatar({ name, image, className = 'avatar' }) {
  const initial = (name || '?').charAt(0).toUpperCase();
  if (image) {
    return <img className={`${className} has-photo`} src={image} alt="" referrerPolicy="no-referrer" />;
  }
  return <span className={className}>{initial}</span>;
}
