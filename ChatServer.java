import java.io.*;
import java.net.*;

public class ChatServer {
    public static void main(String[] args) {

        try (ServerSocket server = new ServerSocket(5678)) {

            System.out.println("Server started...");
            System.out.println("Waiting for client...");

            Socket socket = server.accept();
            System.out.println("Client connected.");

            BufferedReader in = new BufferedReader(
                    new InputStreamReader(socket.getInputStream()));

            PrintWriter out = new PrintWriter(
                    socket.getOutputStream(), true);

            BufferedReader keyboard = new BufferedReader(
                    new InputStreamReader(System.in));

            String msg;

            while (true) {
                // Receive from client
                msg = in.readLine();

                if (msg == null || msg.equalsIgnoreCase("exit")) {
                    System.out.println("Client disconnected.");
                    break;
                }

                System.out.println("Client: " + msg);

                // Send reply
                System.out.print("You: ");
                msg = keyboard.readLine();

                if (msg.equalsIgnoreCase("exit")) {
                    out.println("exit");
                    break;
                }

                out.println(msg);
            }

            socket.close();

        } catch (IOException e) {
            e.printStackTrace(); // better debugging
        }
    }
}