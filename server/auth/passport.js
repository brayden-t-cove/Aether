import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as LocalStrategy } from 'passport-local';
import { findUserByEmail, findUserById, resolveGoogleUser, verifyPassword } from '../lib/users.js';

const INVALID_LOGIN = { message: 'Invalid email or password' };

export function configurePassport(db, config) {
  const instance = new passport.Passport();

  instance.serializeUser((user, done) => done(null, user.id));
  instance.deserializeUser(async (id, done) => {
    try {
      const user = await findUserById(db, id);
      // Deactivated users are signed out on their next request.
      done(null, user?.active ? user : false);
    } catch (err) {
      done(err);
    }
  });

  instance.use(
    new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
      try {
        const user = await findUserByEmail(db, email);
        if (!user?.active || !(await verifyPassword(user, password))) return done(null, false, INVALID_LOGIN);
        done(null, user);
      } catch (err) {
        done(err);
      }
    }),
  );

  if (config.google.enabled) {
    instance.use(
      new GoogleStrategy(
        {
          clientID: config.google.clientId,
          clientSecret: config.google.clientSecret,
          callbackURL: `${config.publicUrl}/auth/google/callback`,
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = profile.emails?.find((e) => e.verified !== false)?.value;
            if (!email) return done(null, false, { message: 'no_email' });
            const user = await resolveGoogleUser(
              db,
              { email, name: profile.displayName, avatarUrl: profile.photos?.[0]?.value, googleId: profile.id },
              { adminEmail: config.adminEmail },
            );
            done(null, user || false, user ? undefined : { message: 'not_invited' });
          } catch (err) {
            done(err);
          }
        },
      ),
    );
  }

  return instance;
}
