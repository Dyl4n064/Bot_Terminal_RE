require('dotenv').config();

// --- 0. VÉRIFICATION CRITIQUE (Pour Render) ---
const requiredEnv = ['DISCORD_TOKEN', 'SUPABASE_URL', 'SUPABASE_KEY'];
requiredEnv.forEach(key => {
    if (!process.env[key]) {
        console.error(`!!! ERREUR : La variable ${key} est manquante !!!`);
        process.exit(1);
    }
});

const { Client, GatewayIntentBits, EmbedBuilder, ApplicationCommandOptionType } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');

// --- 1. CONFIGURATION DU MINI-SERVEUR WEB ---
const app = express();
app.get('/', (req, res) => res.send('Le Terminal ARK est en ligne et fonctionnel.'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`[SYSTEMA] Serveur web actif sur le port ${PORT}`));

// --- 2. INITIALISATION BASE DE DONNÉES ET DISCORD ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const COULEUR_TERMINAL = '#00FF41';
const COULEUR_ALERTE = '#FF0000';

bot.once('ready', async () => {
    console.log(`[SYSTEMA] Bot connecté en tant que : ${bot.user.tag}`);
    
    try {
        const guildId = process.env.GUILD_ID; 
        if (!guildId) console.log("[Alerte] GUILD_ID non détecté, utilisation des commandes globales.");

        const guild = guildId ? bot.guilds.cache.get(guildId) : null;
        let commands = guild ? guild.commands : bot.application.commands;

        await commands.set([
            {
                name: 'incarner',
                description: '🎭 Sélectionner le personnage que vous incarnez actuellement',
                options: [{ name: 'nom', type: ApplicationCommandOptionType.String, description: 'Nom exact du personnage', required: true }]
            },
            {
                name: 'journal',
                description: '📝 Gérer le journal de bord du personnage incarné',
                options: [
                    {
                        name: 'ecrire',
                        type: ApplicationCommandOptionType.Subcommand,
                        description: 'Ajouter une entrée au journal du personnage actuel',
                        options: [{ name: 'texte', type: ApplicationCommandOptionType.String, description: 'Contenu du rapport', required: true }]
                    },
                    {
                        name: 'lire',
                        type: ApplicationCommandOptionType.Subcommand,
                        description: 'Consulter les archives du personnage actuel',
                        options: [{ name: 'numero', type: ApplicationCommandOptionType.Integer, description: 'Numéro du rapport', required: true }]
                    }
                ]
            },
            {
                name: 'fiche',
                description: '🔍 Consulter la base de données centrale',
                options: [
                    {
                        name: 'categorie',
                        type: ApplicationCommandOptionType.String,
                        description: 'Le type de dossier à rechercher',
                        required: true,
                        choices: [
                            { name: '👤 Personnage', value: 'personnages' },
                            { name: '🏢 Organisation', value: 'organisations' },
                            { name: '🦠 Souche / Virus', value: 'souches' }
                        ]
                    },
                    { name: 'nom', type: ApplicationCommandOptionType.String, description: 'Le nom recherché', required: true }
                ]
            },
            {
                name: 'rapport',
                description: '📂 Consulter les rapports d\'enquête de l\'Agence',
                options: [{ name: 'titre', type: ApplicationCommandOptionType.String, description: 'Mots-clés du rapport', required: true }]
            }
        ]);
        console.log("[SYSTEMA] Commandes slash synchronisées.");
    } catch (err) {
        console.error("[ERREUR] Impossible de charger les commandes :", err);
    }
});

// --- 3. LOGIQUE DES COMMANDES ---
bot.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, user } = interaction;

    // --- COMMANDE : INCARNER ---
    if (commandName === 'incarner') {
        const nomPersonnage = options.getString('nom');
        const { error } = await supabase.from('liaison_agents').upsert({ discord_id: user.id, nom_agent: nomPersonnage });

        if (error) return interaction.reply({ content: `❌ Erreur système : ${error.message}`, ephemeral: true });
        return interaction.reply({ content: `🎭 **[SYNCHRONISATION RÔLE]**\nVous incarnez désormais : **${nomPersonnage}**.` });
    }

    // --- VÉRIFICATION D'IDENTITÉ ---
    const { data: liaison } = await supabase.from('liaison_agents').select('nom_agent').eq('discord_id', user.id).single();

    if (!liaison && (commandName === 'journal')) {
        return interaction.reply({ content: "⚠️ Accès refusé. Choisissez d'abord un personnage avec `/incarner`.", ephemeral: true });
    }

    // --- COMMANDE : JOURNAL ---
    if (commandName === 'journal') {
        const sousCommande = options.getSubcommand();
        const persoActuel = liaison.nom_agent;

        if (sousCommande === 'ecrire') {
            const texte = options.getString('texte');
            const { error } = await supabase.from('journal_bord').insert([{ auteur: persoActuel, contenu: texte }]);
            if (error) return interaction.reply({ content: `❌ Échec : ${error.message}`, ephemeral: true });
            return interaction.reply({ content: `📡 **[LOG ENREGISTRÉ]**\nEntrée ajoutée au journal de **${persoActuel}**.` });
        }

        if (sousCommande === 'lire') {
            const numero = options.getInteger('numero');
            const { data: journaux } = await supabase.from('journal_bord').select('*').eq('auteur', persoActuel).order('created_at', { ascending: true });

            if (!journaux || journaux.length === 0 || numero > journaux.length || numero <= 0) {
                return interaction.reply({ content: `❌ Archive introuvable pour **${persoActuel}**.`, ephemeral: true });
            }

            const cible = journaux[numero - 1];
            const date = new Date(cible.created_at).toLocaleDateString('fr-FR');
            const embedLog = new EmbedBuilder()
                .setColor(COULEUR_TERMINAL)
                .setTitle(`📁 JOURNAL DE BORD // ${persoActuel.toUpperCase()}`)
                .setDescription(`*Rapport N°${numero} :*\n\n"${cible.contenu}"`)
                .setFooter({ text: `Date de consigne : ${date}` });

            return interaction.reply({ embeds: [embedLog] });
        }
    }

    // --- COMMANDE : FICHE ---
    if (commandName === 'fiche') {
        const tableCible = options.getString('categorie');
        const recherche = options.getString('nom');
        const { data: resultats } = await supabase.from(tableCible).select('*').ilike('nom', `%${recherche}%`).limit(1);

        if (!resultats || resultats.length === 0) {
            return interaction.reply({ content: `❌ Aucun dossier crypté trouvé pour "${recherche}" dans **${tableCible}**.`, ephemeral: true });
        }

        const cible = resultats[0];
        const estDecede = cible.statut?.toLowerCase().includes('décédé') || cible.statut?.toLowerCase().includes('présumé') || cible.statut?.toLowerCase().includes('détruit');

        const embedFiche = new EmbedBuilder()
            .setColor(estDecede ? COULEUR_ALERTE : COULEUR_TERMINAL)
            .setTitle(`🗂️ DOSSIER : ${cible.nom.toUpperCase()}`);

        if (cible.espece) embedFiche.addFields({ name: '🧬 Classification', value: cible.espece, inline: true });
        if (cible.statut) embedFiche.addFields({ name: '📊 Statut', value: cible.statut, inline: true });
        if (cible.affiliation) embedFiche.addFields({ name: '🏢 Affiliation', value: cible.affiliation, inline: false });
        
        // --- ADAPTATION DYNAMIQUE DES COLONNES SELON LA TABLE ---
        const champTexte = tableCible === 'personnages' ? 'histoire_complete' : 'description';
        const titreTexte = tableCible === 'personnages' ? '📝 Histoire' : '📝 Description';
        const texteLong = cible[champTexte];

        if (texteLong && texteLong.trim() !== '') {
            const LIMITE = 1000; // Limite confortable avant découpage

            if (texteLong.length > LIMITE) {
                // Recherche du dernier saut de ligne avant la limite pour un rendu de texte propre
                const partie1 = texteLong.substring(0, LIMITE);
                const dernierSaut = partie1.lastIndexOf('\n');
                const decoupe = dernierSaut > 0 ? dernierSaut : LIMITE;
                
                embedFiche.addFields({ name: `${titreTexte} (Partie 1)`, value: texteLong.substring(0, decoupe) });
                embedFiche.addFields({ name: `${titreTexte} (Partie 2)`, value: texteLong.substring(decoupe) });
            } else {
                embedFiche.addFields({ name: titreTexte, value: texteLong });
            }
        } else {
            // Message explicite si la case dans la bdd est vide ou inexistante
            embedFiche.addFields({ name: titreTexte, value: `*[ERREUR] Aucune donnée classifiée dans la colonne "${champTexte}".*` });
        }

        if (cible.image_url) embedFiche.setThumbnail(cible.image_url);

        return interaction.reply({ embeds: [embedFiche] });
    }

    // --- COMMANDE : RAPPORT ---
    if (commandName === 'rapport') {
        const recherche = options.getString('titre');
        const { data: rapports } = await supabase.from('rapports_enquete').select('*').ilike('titre', `%${recherche}%`).limit(1);

        if (!rapports || rapports.length === 0) {
            return interaction.reply({ content: `❌ Aucun rapport classifié sous l'intitulé : "${recherche}".`, ephemeral: true });
        }

        const rapport = rapports[0];
        const embedRapport = new EmbedBuilder()
            .setColor(COULEUR_TERMINAL)
            .setTitle(`📂 ENQUÊTE : ${rapport.titre}`)
            .setDescription(rapport.contenu)
            .setFooter({ text: `Auteur : ${rapport.auteur_enquete || 'Inconnu'}` });

        return interaction.reply({ embeds: [embedRapport] });
    }
});

bot.login(process.env.DISCORD_TOKEN);
