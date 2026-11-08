let currentUser = null;
let currentProfile = null;
let conversations = [];
let profiles = new Map();
let onlineUsers = new Map();

// le temps réel, un seul canal pour tout
let globalChannel = null;
let presenceChannel = null;

// la conversation ouverte en ce moment
let activeConversation = null;
let currentMessages = [];

// état de nos messages : envoyé / reçu / lu
let messageStatus = new Map();

// messages longs : réduits par défaut, mémorisé par message
let expandedMessages = new Set();
const LONG_MESSAGE_LIMIT = 480;

// aperçu et non-lus pour la liste de gauche
let lastMessages = new Map();
let unreadCounts = new Map();

let typingTimer = null;
let typingAwayTimer = null;

// PETITS OUTILS

function getOtherUser(conversation) {
    const otherId = conversation.users_id.find(
        id => id !== currentUser.id
    );

    return profiles.get(otherId);
}

function isImageMessage(content) {
    return content.startsWith("data:image/") ||
        /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif)(\?\S*)?$/i.test(content);
}

function extractYouTubeId(content) {
    const lien = content.match(
        /(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/
    );

    return lien ? lien[1] : null;
}

// API transcription : GET JSON, sans clé, CORS ouvert
async function fetchYouTubeTranscript(videoId) {
    const response = await fetch(
        "https://api.freetranscriptapi.com/v1/transcript?video_url=" + videoId
    );

    if (!response.ok) {
        throw new Error("Code " + response.status);
    }

    const data = await response.json();

    if (!Array.isArray(data.transcript) || !data.transcript.length) {
        throw new Error("Aucune transcription disponible pour cette vidéo.");
    }

    return data.transcript
        .map(segment => segment.text.trim())
        .join("\n");
}

function formatTime(date) {
    return new Intl.DateTimeFormat("fr-CA", {
        hour: "2-digit",
        minute: "2-digit"
    }).format(new Date(date));
}

function formatDay(date) {
    const jour = new Date(date);
    const aujourdhui = new Date();
    const hier = new Date();
    hier.setDate(hier.getDate() - 1);

    if (jour.toDateString() === aujourdhui.toDateString()) return "Aujourd'hui";
    if (jour.toDateString() === hier.toDateString()) return "Hier";

    return new Intl.DateTimeFormat("fr-CA", {
        day: "numeric",
        month: "long",
        year: "numeric"
    }).format(jour);
}

// PROFILS ET LISTE DE GAUCHE

async function loadOwnProfile() {
    const { data, error } = await client
        .from("profiles")
        .select("user_id,pseudo")
        .eq("user_id", currentUser.id)
        .single();

    if (error) throw error;

    currentProfile = data;

    geid("current-user-pseudo").textContent = "@" + data.pseudo;
    geid("new-pseudo").value = data.pseudo;
}

async function loadProfiles() {
    const { data, error } = await client
        .from("profiles")
        .select("user_id,pseudo");

    if (error) throw error;

    profiles = new Map(
        data.map(profile => [profile.user_id, profile])
    );
}

async function loadConversations() {
    const { data, error } = await client
        .from("conversations")
        .select("conv_id,users_id,created_at")
        .contains("users_id", [currentUser.id]);

    if (error) throw error;

    conversations = data || [];
}

// le dernier message de chaque conversation, pour l'aperçu
async function loadPreviewMessages() {
    const ids = conversations.map(conversation => conversation.conv_id);

    if (!ids.length) return;

    const { data, error } = await client
        .from("messages")
        .select("id,created_at,conv_id,user_id,content")
        .in("conv_id", ids)
        .order("created_at", { ascending: false })
        .limit(50);

    if (error) throw error;

    (data || []).forEach(message => {
        if (!lastMessages.has(message.conv_id)) {
            lastMessages.set(message.conv_id, message);
        }
    });
}

function displayConversations() {
    const list = geid("conversation-list");
    const search = geid("conversation-search").value.toLowerCase();

    list.replaceChildren();

    // triees par le message le plus récent
    const triees = [...conversations].sort((a, b) => {
        const dernierA = lastMessages.get(a.conv_id);
        const dernierB = lastMessages.get(b.conv_id);

        if (!dernierA && !dernierB) return 0;
        if (!dernierA) return 1;
        if (!dernierB) return -1;

        return new Date(dernierB.created_at) - new Date(dernierA.created_at);
    });

    const visibles = triees.filter(conversation => {
        const user = getOtherUser(conversation);
        return user && user.pseudo.toLowerCase().includes(search);
    });

    if (!visibles.length) {
        const message = document.createElement("p");
        message.className = "empty-state";
        message.textContent = "Aucune conversation pour le moment.";
        list.appendChild(message);
        return;
    }

    visibles.forEach(conversation => {
        const user = getOtherUser(conversation);
        const button = document.createElement("button");

        button.type = "button";
        button.className = "conversation-item";

        if (String(conversation.conv_id) === String(activeConversation)) {
            button.classList.add("active");
        }

        const avatar = document.createElement("span");
        avatar.className = "avatar";
        avatar.textContent = user.pseudo[0].toUpperCase();

        const info = document.createElement("span");
        info.className = "conversation-meta";

        const haut = document.createElement("span");
        haut.className = "conversation-name-row";

        const name = document.createElement("span");
        name.className = "conversation-name";
        name.textContent = user.pseudo;

        // petit point vert si en ligne
        if (onlineUsers.has(user.user_id)) {
            const dot = document.createElement("span");
            dot.className = "presence-dot";
            dot.title = "En ligne";
            haut.append(name, dot);
        } else {
            haut.append(name);
        }

        const preview = document.createElement("span");
        preview.className = "conversation-preview";

        const dernier = lastMessages.get(conversation.conv_id);

        if (dernier) {
            const qui = dernier.user_id === currentUser.id ? "Vous : " : "";

            // on raccourcit les longs messages dans l'aperçu
            preview.textContent = isImageMessage(dernier.content)
                ? qui + "Image"
                : qui + dernier.content.slice(0, 60)
                    + (dernier.content.length > 60 ? "…" : "");
        } else {
            preview.textContent = "Aucun message";
        }

        const nonLus = unreadCounts.get(conversation.conv_id) || 0;

        if (nonLus > 0) {
            const badge = document.createElement("span");
            badge.className = "unread-badge";
            badge.textContent = nonLus;
            haut.appendChild(badge);
        }

        info.append(haut, preview);
        button.append(avatar, info);

        button.addEventListener("click", () => {
            openConversation(conversation);
        });

        list.appendChild(button);
    });
}

async function createConversation(pseudo) {
    pseudo = cleanPseudo(pseudo);

    if (!validPseudo(pseudo)) {
        throw new Error("Pseudo invalide.");
    }

    if (pseudo === currentProfile.pseudo.toLowerCase()) {
        throw new Error("Vous ne pouvez pas vous contacter vous-même.");
    }

    const { data: user, error } = await client
        .from("profiles")
        .select("user_id,pseudo")
        .eq("pseudo", pseudo)
        .maybeSingle();

    if (error) throw error;

    if (!user) {
        throw new Error("Utilisateur introuvable.");
    }

    // déjà une conversation avec cette personne ? on l'ouvre
    const existante = conversations.find(conversation => {
        return (
            conversation.users_id.includes(currentUser.id) &&
            conversation.users_id.includes(user.user_id)
        );
    });

    if (existante) {
        await openConversation(existante);
        return;
    }

    const { data, error: erreurCreation } = await client
        .from("conversations")
        .insert({
            users_id: [currentUser.id, user.user_id]
        })
        .select()
        .single();

    if (erreurCreation) throw erreurCreation;

    profiles.set(user.user_id, user);
    conversations.unshift(data);

    displayConversations();
    await openConversation(data);
}

// EN LIGNE / HORS-LIGNE

// tout le monde se joint au même canal de présence,
// le serveur nous dit qui est là
function setupPresence() {
    presenceChannel = client.channel("en-ligne", {
        config: { presence: { key: currentUser.id } }
    });

    presenceChannel
        .on("presence", { event: "sync" }, updateOnlineUsers)
        .subscribe(status => {
            if (status === "SUBSCRIBED") {
                presenceChannel.track({
                    pseudo: currentProfile.pseudo
                });
            }
        });
}

function updateOnlineUsers() {
    const state = presenceChannel.presenceState();

    onlineUsers = new Map();

    Object.entries(state).forEach(([user, metas]) => {
        if (metas.length) onlineUsers.set(user, metas[0]);
    });

    displayConversations();

    if (activeConversation) {
        const conversation = conversations.find(
            c => String(c.conv_id) === String(activeConversation)
        );
        if (conversation) updateChatStatus(conversation);
    }
}

// le petit texte à côté du pseudo dans l'en-tête du chat
function updateChatStatus(conversation) {
    const other = getOtherUser(conversation);
    const subtitle = geid("chat-subtitle");

    subtitle.textContent = onlineUsers.has(other.user_id)
        ? "En ligne"
        : "Hors-ligne";
}

// EN TRAIN D'ÉCRIRE...

function envoyerEcriture() {
    if (!globalChannel || !activeConversation) return;

    const conversation = conversations.find(
        c => String(c.conv_id) === String(activeConversation)
    );
    const other = getOtherUser(conversation);

    globalChannel.send({
        type: "broadcast",
        event: "ecriture",
        payload: {
            from: currentUser.id,
            to: other ? other.user_id : "",
            conv_id: activeConversation
        }
    });
}

function afficherEcriture() {
    const conversation = conversations.find(
        c => String(c.conv_id) === String(activeConversation)
    );

    if (!conversation) return;

    geid("chat-subtitle").textContent = "en train d'écrire...";

    // on le laisse affiché un moment, le temps que la personne tape
    clearTimeout(typingAwayTimer);
    typingAwayTimer = setTimeout(() => {
        updateChatStatus(conversation);
    }, 2500);
}

// MESSAGES

async function loadMessages() {
    const { data, error } = await client
        .from("messages")
        .select("id,created_at,conv_id,user_id,content")
        .eq("conv_id", activeConversation)
        .order("created_at", { ascending: true });

    if (error) throw error;

    currentMessages = data || [];
    displayMessages(currentMessages);

    // on dit à l'autre personne qu'on a lu ses messages
    const sansLus = currentMessages
        .filter(message => message.user_id !== currentUser.id)
        .map(message => message.id);

    if (sansLus.length && globalChannel) {
        const conversation = conversations.find(
            c => String(c.conv_id) === String(activeConversation)
        );
        const other = getOtherUser(conversation);

        if (other) {
            globalChannel.send({
                type: "broadcast",
                event: "lecture",
                payload: {
                    from: currentUser.id,
                    to: other.user_id,
                    conv_id: activeConversation,
                    ids: sansLus
                }
            });
        }
    }
}

function displayMessages(messages) {
    const list = geid("messages-list");
    list.replaceChildren();

    if (!messages.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "Début de la conversation. Envoyez un message !";
        list.appendChild(empty);
        return;
    }

    let jourCourant = null;

    messages.forEach(message => {
        // séparateur de jour (Aujourd'hui, Hier, date...)
        const jour = formatDay(message.created_at);

        if (jour !== jourCourant) {
            jourCourant = jour;

            const separateur = document.createElement("div");
            separateur.className = "day-separator";
            separateur.textContent = jour;
            list.appendChild(separateur);
        }

        const row = document.createElement("div");
        row.className = "message-row";

        if (message.user_id === currentUser.id) {
            row.classList.add("mine");
        }

        const bubble = document.createElement("div");

        if (isImageMessage(message.content)) {
            bubble.className = "message-bubble image";

            const image = document.createElement("img");
            image.src = message.content;
            image.alt = "Image partagée";
            image.loading = "lazy";

            bubble.appendChild(image);

        } else if (message.content.length > LONG_MESSAGE_LIMIT) {
            bubble.className = "message-bubble";

            // message long : réduit par défaut avec un "voir plus"
            const reduit = !expandedMessages.has(message.id);

            const texte = document.createElement("span");
            texte.className = "message-text";
            texte.textContent = reduit
                ? message.content.slice(0, LONG_MESSAGE_LIMIT) + "…"
                : message.content;

            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "expand-toggle";
            toggle.textContent = reduit ? "Voir plus" : "Réduire";

            toggle.addEventListener("click", () => {
                if (reduit) {
                    expandedMessages.add(message.id);
                } else {
                    expandedMessages.delete(message.id);
                }

                displayMessages(currentMessages);
            });

            bubble.append(texte, toggle);

        } else {
            bubble.className = "message-bubble";
            bubble.textContent = message.content;
        }

        row.appendChild(bubble);

        // heure + tic du message (pour les nôtres)
        const info = document.createElement("span");
        info.className = "message-time";
        info.textContent = formatTime(message.created_at);

        const tic = message.user_id === currentUser.id
            ? (messageStatus.get(message.id) || "envoyé")
            : null;

        if (tic === "envoyé") {
            info.textContent += " ✓ envoyé";
        } else if (tic === "reçu") {
            info.textContent += " ✓✓ reçu";
            info.classList.add("recu");
        } else if (tic === "lu") {
            info.textContent += " ✓✓ lu";
            info.classList.add("lu");
        }

        row.appendChild(info);
        list.appendChild(row);
    });

    list.scrollTop = list.scrollHeight;
}

async function openConversation(conversation) {
    activeConversation = conversation.conv_id;

    unreadCounts.delete(activeConversation);

    const user = getOtherUser(conversation);
    const pseudo = user ? user.pseudo : "Conversation";

    geid("chat-title").textContent = pseudo;
    geid("chat-avatar").textContent = pseudo[0].toUpperCase();
    geid("chat-placeholder").hidden = true;
    geid("active-chat").hidden = false;

    updateChatStatus(conversation);
    displayConversations();

    // zone de messages en attendant la requête
    const chargement = document.createElement("p");
    chargement.className = "empty-state";
    chargement.textContent = "Chargement des messages...";
    geid("messages-list").replaceChildren(chargement);

    try {
        await loadMessages();

    } catch (error) {
        geid("messages-list").textContent = error.message;
    }
}

// enregistre le message dans la base et le marque "envoyé"
async function enregistrerMessage(content) {
    const { data, error } = await client
        .from("messages")
        .insert({
            conv_id: activeConversation,
            user_id: currentUser.id,
            content: content
        })
        .select("id")
        .single();

    if (error) throw error;

    messageStatus.set(data.id, "envoyé");
}

// popup : envoyer seulement le lien, ou ajouter la transcription en
// message suivant
function demanderEnvoiYouTube() {
    const dialog = geid("youtube-dialog");

    return new Promise(resolve => {
        const choisir = choix => {
            dialog.onclose = null;
            dialog.close();
            resolve(choix);
        };

        geid("yt-send-link").onclick = () => choisir("lien");
        geid("yt-send-transcript").onclick = () => choisir("transcription");
        geid("yt-cancel").onclick = () => choisir("annuler");

        // fermé avec le × : on n'envoie rien
        dialog.onclose = () => resolve("annuler");

        dialog.showModal();
    });
}

// aperçu de la transcription, l'utilisateur confirme avant l'envoi
function afficherTranscription(transcript) {
    const dialog = geid("transcript-dialog");

    return new Promise(resolve => {
        const decider = envoyer => {
            dialog.onclose = null;
            dialog.close();
            resolve(envoyer);
        };

        geid("transcript-send").onclick = () => decider(true);
        geid("transcript-cancel").onclick = () => decider(false);

        // fermé avec le × : transcription non envoyée
        dialog.onclose = () => resolve(false);

        dialog.showModal();

        geid("transcript-preview").textContent = transcript;
    });
}

async function sendMessage(event) {
    event.preventDefault();

    const input = geid("message-input");
    const content = input.value.trim();

    if (!content || !activeConversation) return;

    const button = event.currentTarget.querySelector("button");
    button.disabled = true;

    try {
        const videoId = extractYouTubeId(content);

        if (!videoId) {
            await enregistrerMessage(content);

        } else {
            const choix = await demanderEnvoiYouTube();

            // la personne a changé d'idée : rien n'est envoyé
            if (choix === "annuler") return;

            // le lien part toujours en premier
            await enregistrerMessage(content);

            if (choix === "transcription") {
                const transcript = await fetchYouTubeTranscript(videoId);

                if (await afficherTranscription(transcript)) {
                    await enregistrerMessage(transcript);
                }
            }
        }

        input.value = "";
        await loadMessages();

    } catch (error) {
        alert("Erreur lors de l'envoi : " + error.message);
    }

    button.disabled = false;
    input.focus();
}

// IMAGES

function setupImageSharing() {
    geid("attach-button").addEventListener("click", () => {
        geid("attach-input").click();
    });

    geid("attach-input").addEventListener("change", async () => {
        const file = geid("attach-input").files[0];
        geid("attach-input").value = "";

        if (!file || !activeConversation) return;

        if (!file.type.startsWith("image/")) {
            alert("Choisissez une image (jpg, png, gif...).");
            return;
        }

        const bouton = geid("attach-button");
        bouton.disabled = true;

        try {
            const dataUrl = await compressImage(file);

            const { error } = await client.from("messages").insert({
                conv_id: activeConversation,
                user_id: currentUser.id,
                content: dataUrl
            });

            if (error) throw error;

            await loadMessages();

        } catch (error) {
            console.error(error);
            alert("Impossible d'envoyer l'image : " + error.message);
        }

        bouton.disabled = false;
    });
}

// envoyé en JPEG, ça allège un peu le message
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            const image = new Image();

            image.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height;

                canvas.getContext("2d")
                    .drawImage(image, 0, 0, canvas.width, canvas.height);

                resolve(canvas.toDataURL("image/jpeg", 0.8));
            };

            image.onerror = reject;
            image.src = reader.result;
        };

        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// NOTIFICATIONS

function afficherNotification(message, conversation) {
    const toast = document.createElement("button");
    toast.type = "button";
    toast.className = "toast-notification";
    toast.textContent = message;

    toast.addEventListener("click", () => {
        toast.remove();
        openConversation(conversation);
    });

    geid("toast-zone").appendChild(toast);

    setTimeout(() => toast.remove(), 5000);
}

function majTitreOnglet() {
    let total = 0;

    unreadCounts.forEach(compte => {
        total += compte;
    });

    document.title = total > 0
        ? `(${total}) SuperText — Messagerie`
        : "SuperText — Messagerie";
}

function notifierMessage(message) {
    const conversation = conversations.find(
        c => c.conv_id === message.conv_id
    );

    const auteur = profiles.get(message.user_id);

    if (!conversation || !auteur) return;

    afficherNotification(
        `${auteur.pseudo} vous a envoyé un message`,
        conversation
    );

    majTitreOnglet();
}

// TEMPS RÉEL

// un canal qui surveille tous les nouveaux messages :
// ça sert aux notifications, aux aperçus et aux tics
function setupGlobalChannel() {
    globalChannel = client.channel("fil-rouge-flux");

    globalChannel
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "messages" },
            payload => gestionNouveauMessage(payload.new)
        )
        .on("broadcast", { event: "ecriture" }, ({ payload }) => {
            if (payload.to !== currentUser.id) return;
            if (String(payload.conv_id) !== String(activeConversation)) return;
            afficherEcriture();
        })
        .on("broadcast", { event: "recu" }, ({ payload }) => {
            if (payload.to !== currentUser.id) return;

            payload.ids.forEach(id => {
                if (messageStatus.get(id) === "envoyé") {
                    messageStatus.set(id, "reçu");
                }
            });

            if (String(payload.conv_id) === String(activeConversation)) {
                displayMessages(currentMessages);
            }
        })
        .on("broadcast", { event: "lecture" }, ({ payload }) => {
            if (payload.to !== currentUser.id) return;

            payload.ids.forEach(id => messageStatus.set(id, "lu"));

            if (String(payload.conv_id) === String(activeConversation)) {
                displayMessages(currentMessages);
            }
        })
        .subscribe();
}

// appelé à chaque nouveau message en temps réel
function gestionNouveauMessage(message) {
    const conversation = conversations.find(
        c => c.conv_id === message.conv_id
    );

    // nos messages des autres onglets : aperçu seulement
    if (message.user_id === currentUser.id) {
        if (conversation) {
            lastMessages.set(message.conv_id, message);
            displayConversations();
        }
        return;
    }

    if (!conversation) return;

    // on confirme à l'expéditeur que le message est arrivé
    // ("reçu"), le "lu" part avec loadMessages
    globalChannel.send({
        type: "broadcast",
        event: "recu",
        payload: {
            from: currentUser.id,
            to: message.user_id,
            conv_id: message.conv_id,
            ids: [message.id]
        }
    });

    // aperçu dans la liste de gauche
    lastMessages.set(message.conv_id, message);

    // conversation ouverte sur l'écran = lu direct
    if (String(activeConversation) === String(message.conv_id) && !document.hidden) {
        loadMessages().catch(console.error);

    } else {
        const avant = unreadCounts.get(message.conv_id) || 0;
        unreadCounts.set(message.conv_id, avant + 1);

        notifierMessage(message);
    }

    displayConversations();
}

// PARAMÈTRES

function setupDialogs() {
    const newDialog = geid("new-conversation-dialog");
    const editDialog = geid("edit-pseudo-dialog");

    geid("new-conversation-button").onclick = () => newDialog.showModal();
    geid("placeholder-new-button").onclick = () => newDialog.showModal();

    geid("edit-pseudo-button").onclick = () => editDialog.showModal();

    document.querySelectorAll("[data-close-dialog]").forEach(button => {
        button.onclick = () => button.closest("dialog").close();
    });

    geid("new-conversation-form").addEventListener("submit", async event => {
        event.preventDefault();

        const button = event.currentTarget.querySelector("button[type=submit]");
        const status = geid("new-conversation-status");

        button.disabled = true;
        showStatus(status, "Recherche...");

        try {
            await createConversation(geid("target-pseudo").value);

            geid("target-pseudo").value = "";
            newDialog.close();

        } catch (error) {
            showStatus(status, error.message);
        }

        button.disabled = false;
    });

    geid("edit-pseudo-form").addEventListener("submit", async event => {
        event.preventDefault();

        const pseudo = cleanPseudo(geid("new-pseudo").value);
        const button = event.currentTarget.querySelector("button[type=submit]");
        const status = geid("edit-pseudo-status");

        if (!validPseudo(pseudo)) {
            showStatus(status, "Pseudo invalide.");
            return;
        }

        button.disabled = true;

        try {
            const { data, error } = await client
                .from("profiles")
                .update({ pseudo })
                .eq("user_id", currentUser.id)
                .select()
                .single();

            if (error) throw error;

            currentProfile = data;

            await loadProfiles();

            geid("current-user-pseudo").textContent = "@" + pseudo;

            displayConversations();

            showStatus(status, "Pseudo modifié.", true);

            setTimeout(() => editDialog.close(), 600);

        } catch (error) {
            showStatus(
                status,
                /duplicate|unique/i.test(error.message)
                    ? "Ce pseudo est déjà utilisé."
                    : error.message
            );
        }

        button.disabled = false;
    });
}

// initialisation de la page messagerie.html

async function startMessenger() {
    if (!geid("conversation-list")) return;

    try {
        const { data, error } = await client.auth.getUser();

        if (error) throw error;

        currentUser = data.user;

        if (!currentUser) {
            location.href = "./index.html";
            return;
        }

        // les deux profils en parallèle, c'est plus rapide
        await Promise.all([
            loadOwnProfile(),
            loadProfiles()
        ]);

        await loadConversations();
        await loadPreviewMessages();

        // la liste peut s'afficher sans attendre le reste
        displayConversations();

        setupPresence();
        setupGlobalChannel();
        setupDialogs();
        setupImageSharing();

        geid("conversation-search").addEventListener(
            "input",
            displayConversations
        );

        geid("message-form").addEventListener("submit", sendMessage);

        // "en train d'écrire", au maximum aux 2 secondes
        geid("message-input").addEventListener("input", () => {
            if (typingTimer) return;

            envoyerEcriture();

            typingTimer = setTimeout(() => {
                typingTimer = null;
            }, 2000);
        });

        // retour sur l'onglet : on fait le ménage des notifications
        document.addEventListener("visibilitychange", () => {
            majTitreOnglet();

            if (!document.hidden && activeConversation) {
                loadMessages().catch(console.error);
            }
        });

        geid("signout-button").addEventListener("click", async () => {
            await client.auth.signOut();
            location.href = "./index.html";
        });

    } catch (error) {
        console.error(error);

        geid("conversation-list").textContent =
            "Erreur : " + error.message;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    startMessenger().catch(console.error);
});
