# SuperText — projet fil rouge 8WEB101

SuperText est une messagerie instantanée Web qui permet d'échanger
des messages texte (et des images) en temps réel avec les autres
membres inscrits sur la plateforme.

Le site est publié avec GitHub Pages :
[https://skamra.github.io/tp1-web/](https://skamra.github.io/tp1-web-uqac/)

## Fonctionnement

Chaque personne crée un compte avec un pseudo (unique), puis peut
démarrer une conversation avec n'importe quel autre membre en
saisissant son pseudo. La liste des conversations se trouve dans la
colonne de gauche, et la discussion ouverte s'affiche à droite.

## Fonctionnalités de base

- Inscription / connexion (via Supabase Auth, mot de passe de
  12 caractères minimum avec majuscule, chiffre et caractère spécial)
- Liste de contacts et de salons de conversation, avec recherche
- Envoi et réception de messages texte en temps réel
  (Supabase Realtime)
- Messages horodatés, avec séparation par jour (Aujourd'hui, Hier...)

## Fonctionnalités secondaires

- Notification visuelle à la réception d'un nouveau
  message (toast en bas à droite + compteur dans le titre de l'onglet)
- Partage d'images, compressées et affichées directement dans la
  conversation
- Indicateur « en ligne / hors-ligne » (Supabase Realtime Presence)
- Indicateur « en train d'écrire... »
- Accusés de réception : ✓ envoyé, ✓✓ reçu, ✓✓ lu

## Technologies

HTML, CSS et JavaScript, avec le service Supabase (authentification,
base de données PostgreSQL et temps réel). Aucun framework, tout est
codé dans le dossier `static/`.


## Nouveautés
- Messages en temps réel
- Présence en ligne/hors-ligne
- Accusés de réception
- Partage d'images
