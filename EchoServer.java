import java.io.*;
import java.net.*;

public class EchoServer {
    public static void main(String[] args) {
        try (ServerSocket server = new ServerSocket(5678)) {
            System.out.println("Server started...");

            Socket socket = server.accept();
            System.out.println("Client connected");

            BufferedReader in = new BufferedReader(
                new InputStreamReader(socket.getInputStream()));
            BufferedWriter out = new BufferedWriter(
                new OutputStreamWriter(socket.getOutputStream()));

            String message;

            while ((message = in.readLine()) != null) {
                System.out.println("Client: " + message);

                out.write(message);
                out.newLine();
                out.flush();
            }

        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}