const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const getTweetId = (url) => {
    const matches = url.match(/(?:twitter|x)\.com\/[^/]+\/status\/(\d+)/);
    return matches ? matches[1] : null;
};

const config = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
};

app.get('/', (req, res) => {
    const path = require('path');
res.sendFile(path.join(__dirname, '..', 'index.html'));

});

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

        const apiUrl = `https://api.vxtwitter.com/Twitter/status/${tweetId}`;
        const response = await axios.get(apiUrl, config);
        const videoData = response.data;
        
        console.log('Response data:', JSON.stringify(videoData, null, 2));

        if (!videoData.media_extended || !videoData.media_extended.length) {
            throw new Error('Aucune vidéo trouvée dans ce tweet');
        }

        const videos = [{
            thumbnail: videoData.media_extended[0].thumbnail_url,
            versions: [{
                url: videoData.media_extended[0].url,
                type: 'video/mp4'
            }]
        }];

        if (!videos.length) {
            throw new Error('Aucune vidéo trouvée dans ce tweet');
        }

        res.json({ videos });
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({
            error: 'Erreur lors de la récupération de la vidéo',
            details: error.message
        });
    }
});

app.get('/api/download', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).json({ error: 'URL de la vidéo requise' });
        }

        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            ...config
        });

        res.setHeader('Content-Disposition', 'attachment; filename=twitter-video.mp4');
        res.setHeader('Content-Type', 'video/mp4');
        response.data.pipe(res);
    } catch (error) {
        console.error('Erreur de téléchargement:', error);
        res.status(500).json({
            error: 'Erreur lors du téléchargement',
            details: error.message
        });
    }
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({
        error: 'Erreur serveur interne',
        details: err.message
    });
});

app.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);


    
});

