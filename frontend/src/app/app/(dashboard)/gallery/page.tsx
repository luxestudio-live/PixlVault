"use client";

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useAuth } from '@/components/auth-provider';
import { MediaGallery } from '@/components/media-gallery';

export default function GalleryPage() {
  const { getIdToken } = useAuth();
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void (async () => {
      const token = await getIdToken();
      if (active) {
        setIdToken(token);
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [getIdToken]);

  if (loading || !idToken) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-white/70">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return <MediaGallery idToken={idToken} refreshKey={0} />;
}
