const express = require('express');
const cors = require('cors');
const axios = require('axios');
const NodeCache = require('node-cache');
const app = express();
const PORT = process.env.PORT || 3000;

// Initialisation du cache
const mediaCache = new NodeCache({ stdTTL: 3600 });

// Configuration CORS améliorée
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range', 'Accept', 'Origin'],
    exposedHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges', 'Content-Type', 'Content-Disposition'],
    credentials: true
}));

// Middleware pour parser le JSON
app.use(express.json());

// Route de base pour vérifier que l'API fonctionne
app.get('/', (req, res) => {
    res.json({ message: "API is running" });
});

// Configuration axios avec timeout et retry
const config = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    },
    timeout: 10000,
    retry: 3
};

// Fonction pour extraire l'ID du tweet
const getTweetId = (url) => {
    const matches = url.match(/(?:twitter|x)\.com\/[^/]+\/status\/(\d+)/);
    return matches ? matches[1] : null;
};

// Fonction pour traiter les médias
const processMediaExtended = (mediaExtended) => {
    return mediaExtended.map(media => {
        if (media.type === 'video' || media.type === 'animated_gif') {
            return {
                type: media.type,
                thumbnail: media.thumbnail_url,
                versions: media.variants ? media.variants.map(variant => ({
                    url: variant.url,
                    bitrate: variant.bitrate,
                    content_type: variant.content_type,
                    resolution: getResolutionFromUrl(variant.url)
                })).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0)) : [{
                    url: media.url,
                    type: 'video/mp4',
                    resolution: getResolutionFromUrl(media.url)
                }]
            };
        } else if (media.type === 'photo') {
            return {
                type: 'photo',
                url: media.url || media.media_url_https,
                width: media.width,
                height: media.height,
                thumbnail: media.url || media.media_url_https
            };
        }
        return null;
    }).filter(Boolean);
};

// Fonction pour extraire la résolution de l'URL
const getResolutionFromUrl = (url) => {
    const resMatch = url.match(/\/(\d+x\d+)\//);
    return resMatch ? resMatch[1] : null;
};

app.post('/api/video-info', async (req, res) => {
    try {
        const { tweetUrl } = req.body;
        if (!tweetUrl) {
            return res.status(400).json({ error: 'URL du tweet requise' });
        }

        const tweetId = getTweetId(tweetUrl);
        if (!tweetId) {
            return res.status(400).json({ error: 'URL du tweet invalide' });
        }

        // Vérifier le cache
        const cachedData = mediaCache.get(tweetId);
        if (cachedData) {
            return res.json(cachedData);
        }

        const apiUrl = `https://api.vxtwitter.com/Twitter/status/${tweetId}`;
        const response = await axios.get(apiUrl, config);
        const tweetData = response.data;

        if (!tweetData.media_extended || !tweetData.media_extended.length) {
            throw new Error('Aucun média trouvé dans ce tweet');
        }

        const medias = processMediaExtended(tweetData.media_extended);

        if (!medias.length) {
            throw new Error('Aucun média exploitable trouvé dans ce tweet');
        }

        const responseData = { medias };
        mediaCache.set(tweetId, responseData);

        res.json(responseData);
    } catch (error) {
        console.error('Erreur:', error);
        res.status(error.response?.status || 500).json({
            error: 'Erreur lors de la récupération des médias',
            details: error.message
        });
    }
});

app.get('/api/download', async (req, res) => {
    try {
        const { url, type } = req.query;
        if (!url) {
            return res.status(400).json({ error: 'URL du média requise' });
        }

        // Configuration de la requête avec support des requêtes partielles
        const headers = { ...config.headers };
        if (req.headers.range) {
            headers.range = req.headers.range;
        }

        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            headers,
            timeout: 30000,
            maxRedirects: 5
        });

        // Gestion du type de contenu et des headers
        const contentType = type === 'photo' ? 'image/jpeg' : 'video/mp4';
        const extension = type === 'photo' ? '.jpg' : '.mp4';
        const filename = `x-media-${Date.now()}${extension}`;

        // Headers de base
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.setHeader('Last-Modified', (new Date()).toUTCString());

        // Gestion des requêtes partielles
        if (response.headers['content-range']) {
            res.setHeader('Content-Range', response.headers['content-range']);
            res.status(206);
        } else {
            res.setHeader('Content-Length', response.headers['content-length']);
        }

        // Streaming de la réponse
        response.data.pipe(res);

        // Gestion des erreurs pendant le streaming
        response.data.on('error', (error) => {
            console.error('Erreur pendant le streaming:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    error: 'Erreur pendant le streaming',
                    details: error.message
                });
            }
        });
    } catch (error) {
        console.error('Erreur de téléchargement:', error);
        if (!res.headersSent) {
            res.status(500).json({
                error: 'Erreur lors du téléchargement',
                details: error.message
            });
        }
    }
});

// Middleware de gestion des erreurs
app.use((err, req, res, next) => {
    console.error('Erreur globale:', err);
    if (!res.headersSent) {
        res.status(500).json({
            error: 'Erreur serveur interne',
            details: err.message
        });
    }
});

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});

