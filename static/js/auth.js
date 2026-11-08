"use strict";

// Informations du projet Supabase
const SUPABASE_URL = "https://xxtdixtgyqgtdeulffii.supabase.co";
const SUPABASE_KEY = "sb_publishable_7Gm9X2akpLzoNWfpBBaz0w_9a_sBvqC";

const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const geid = (id) => document.getElementById(id);

function showStatus(element, message, success = false) {
    if (!element) return;

    element.textContent = message;
    element.classList.toggle("success", success);
}

function cleanPseudo(value) {
    return value.trim().toLowerCase();
}

function validPseudo(value) {
    return /^[a-z0-9_]{3,20}$/.test(value);
}

function passwordIsValid(password) {
    return (
        password.length >= 12 &&
        /[A-Z]/.test(password) &&
        /[a-z]/.test(password) &&
        /\d/.test(password) &&
        /[^A-Za-z0-9]/.test(password)
    );
}

// CONNEXION

async function login() {
    const form = geid("signin-form");
    if (!form) return;

    // si on est déjà connecté, retour à la messagerie
    const session = await client.auth.getSession();

    if (session.data.session) {
        location.href = "./messagerie.html";
        return;
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const button = form.querySelector("button");
        const status = geid("auth-status");

        button.disabled = true;
        showStatus(status, "Connexion...");

        const email = geid("signin-email").value.trim();
        const password = geid("signin-password").value;

        try {
            const { error } = await client.auth.signInWithPassword({
                email,
                password
            });

            if (error) throw error;

            location.href = "./messagerie.html";

        } catch (error) {
            showStatus(status, error.message);
            button.disabled = false;
        }
    });
}

// INSCRIPTION

async function signup() {
    const form = geid("signup-form");
    if (!form) return;

    const session = await client.auth.getSession();

    if (session.data.session) {
        location.href = "./messagerie.html";
        return;
    }

    // les règles du mot de passe se cochent quand on tape
    geid("signup-password").addEventListener("input", () => {
        const password = geid("signup-password").value;

        const rules = {
            length: password.length >= 12,
            upper: /[A-Z]/.test(password),
            lower: /[a-z]/.test(password),
            digit: /\d/.test(password),
            special: /[^A-Za-z0-9]/.test(password)
        };

        Object.entries(rules).forEach(([name, valid]) => {
            const item = document.querySelector(
                `[data-rule="${name}"]`
            );

            if (item) item.classList.toggle("valid", valid);
        });
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const button = form.querySelector("button");
        const status = geid("auth-status");

        const pseudo = cleanPseudo(geid("signup-pseudo").value);
        const email = geid("signup-email").value.trim();
        const password = geid("signup-password").value;

        if (!validPseudo(pseudo)) {
            showStatus(status, "Pseudo invalide. Utilisez 3 à 20 lettres, chiffres ou _.");
            return;
        }

        if (!passwordIsValid(password)) {
            showStatus(status, "Le mot de passe ne respecte pas les règles.");
            return;
        }

        button.disabled = true;
        showStatus(status, "Création du compte...");

        try {
            // le pseudo part avec le compte, un trigger côté base
            // remplit la table profiles
            const { data, error } = await client.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        pseudo: pseudo
                    }
                }
            });

            if (error) throw error;

            if (data.session) {
                location.href = "./messagerie.html";
            } else {
                showStatus(
                    status,
                    "Compte créé. Vérifiez votre adresse courriel si une confirmation est demandée.",
                    true
                );

                button.disabled = false;
            }

        } catch (error) {
            const message = /duplicate|unique/i.test(error.message)
                ? "Ce pseudo ou cette adresse courriel est déjà utilisé."
                : error.message;

            showStatus(status, message);
            button.disabled = false;
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    login().catch(console.error);
    signup().catch(console.error);
});
