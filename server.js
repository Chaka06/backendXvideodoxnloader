const express = require('express');
const cors = require('cors');
const axios = require('axios');
const NodeCache = require('node-cache');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Initialisation du cache
const mediaCache = new NodeCache({ stdTTL: 3600 }); // Cache d'1 heure

// Configuration CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
}));

// Middleware pour parser le JSON
app.use(express.json());

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, '../')));

// Route pour la page d'accueil
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
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

        console.log('Response data:', JSON.stringify(tweetData, null, 2));

        if (!tweetData.media_extended || !tweetData.media_extended.length) {
            throw new Error('Aucun média trouvé dans ce tweet');
        }

        const medias = processMediaExtended(tweetData.media_extended);

        if (!medias.length) {
            throw new Error('Aucun média exploitable trouvé dans ce tweet');
        }

        // Stocker dans le cache
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

        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            ...config,
            timeout: 30000
        });

        // Déterminer le type de contenu
        const contentType = type === 'photo' ? 'image/jpeg' : 'video/mp4';
        const extension = type === 'photo' ? '.jpg' : '.mp4';
        
        const filename = `x-media-${Date.now()}${extension}`;
        
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.setHeader('Last-Modified', (new Date()).toUTCString());

        response.data.pipe(res);
    } catch (error) {
        console.error('Erreur de téléchargement:', error);
        res.status(500).json({
            error: 'Erreur lors du téléchargement',
            details: error.message
        });
    }
});

// Middleware de gestion des erreurs
app.use((err, req, res, next) => {
    console.error('Erreur globale:', err);
    res.status(500).json({
        error: 'Erreur serveur interne',
        details: err.message
    });
});

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});